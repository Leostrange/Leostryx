"""
Task executor module for Antigravity v2 daemon.
Handles process execution (bash/python/rish), notification dispatch, logging,
and workspace UI waking.
"""

import os
import sys
import time
import json
import shlex
import signal
import fcntl
import threading
import contextlib
import subprocess
from concurrent.futures import ThreadPoolExecutor

PREFIX = os.environ.get("PREFIX") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
HOME = os.environ.get("HOME") or os.path.dirname(PREFIX)


def ui_language():
    """Language of the interface: $AGY_LANG, then ~/.agy_lang, then ru.

    The app writes the selected language into "$HOME/.agy_lang" (agy-tools op
    setlang). Daemon notifications have to follow it, otherwise the shade keeps
    answering in English while the UI is Russian.
    """
    value = os.environ.get("AGY_LANG", "")
    if not value:
        try:
            with open(os.path.join(HOME, ".agy_lang"), "r", encoding="utf-8") as fh:
                value = fh.read(8)
        except OSError:
            value = ""
    value = value.strip().lower()
    return "en" if value.startswith("en") else "ru"


def L(ru, en):
    """Pick the string matching the current interface language."""
    return en if AGY_LANG == "en" else ru


AGY_LANG = ui_language()


def application_id_from_prefix():
    files_dir = os.path.dirname(os.path.normpath(PREFIX))
    if os.path.basename(files_dir) != "files":
        return ""
    return os.path.basename(os.path.dirname(files_dir))


AGY_APPLICATION_ID = (os.environ.get("AGY_APPLICATION_ID")
                      or os.environ.get("RISH_APPLICATION_ID")
                      or application_id_from_prefix())
RISH_BIN = os.path.join(PREFIX, "bin", "rish")
BASH_BIN = os.path.join(PREFIX, "bin", "bash")
CONFIG_DIR = os.path.join(HOME, ".gemini", "antigravity-app", "daemon")
TASKS_FILE = os.path.join(CONFIG_DIR, "tasks.json")
LOG_FILE = os.path.join(CONFIG_DIR, "daemon.log")
PID_FILE = os.path.join(CONFIG_DIR, "daemon.pid")
STOP_EVENT = threading.Event()

# Global pool for executing tasks without blocking the main scheduler
TASK_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agy_worker")
RUNNING_JOBS = set()
RUNNING_LOCK = threading.Lock()


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{ts}] {msg}"
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass
    # daemonize() dup2()s stdout onto LOG_FILE. Printing as well would append
    # every line a second time, which made a single loop look like two.
    try:
        redirected = os.path.realpath("/proc/self/fd/1") == os.path.realpath(LOG_FILE)
    except OSError:
        redirected = False
    if not redirected:
        print(formatted, flush=True)


def notify(title, message, tag=None):
    log(f"Notification: {title} - {message}")
    cmd = ["agy-notify", "post", "-t", title, "-m", message]
    if tag:
        cmd.extend(["--tag", tag])
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        log(f"Notification failed: {e}")


def load_tasks():
    if not os.path.isfile(TASKS_FILE):
        return []
    try:
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log(f"Error loading tasks: {e}")
        return []


def save_tasks(tasks):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp_path = TASKS_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, TASKS_FILE)


@contextlib.contextmanager
def tasks_lock():
    """Serialise read-modify-write cycles on tasks.json.

    The scheduler and the task workers both rewrite this file. Without a lock a
    tick that started before a worker finished could save its stale snapshot
    afterwards and erase last_run_status/last_run_ts, which is why finished
    tasks kept looking unfinished.
    """
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(TASKS_FILE + ".lock", "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def patch_tasks(patches):
    """Merge-only update: writes just the given fields of the given task ids.

    Fields the caller does not mention are left untouched, so the scheduler and
    a finishing worker never overwrite each other's data.
    """
    if not patches:
        return
    with tasks_lock():
        tasks = load_tasks()
        for t in tasks:
            fields = patches.get(t.get("id"))
            if not fields:
                continue
            for k, v in fields.items():
                t[k] = v
        save_tasks(tasks)


def task_is_stale(task, now=None, grace=60):
    """True when a task claims to be running but cannot be any more.

    A dead child pid alone is not proof: between the shell exiting and the
    worker writing its result there is a window in which the marker still says
    "running" while the pid is already gone. Reaping in that window would mark
    a perfectly successful run as aborted — hence the grace period.
    """
    if task.get("state") != "running":
        return False
    now = time.time() if now is None else now
    started = task.get("started_at") or 0
    limit = int(task.get("timeout_sec", 600)) + 120
    if not started or (now - started) > limit:
        return True
    pid = task.get("run_pid")
    if pid:
        try:
            os.kill(int(pid), 0)
        except OSError:
            return (now - started) > grace
    return False


def reap_stale(tasks=None):
    """Clear 'running' markers left behind by a killed daemon or a hung child.

    Without this a stale marker is permanent: execute_action_async refuses to
    start a task that looks like it is already running, so a single death in
    the wrong place silently disabled the task forever.
    """
    own = tasks is None
    tasks = load_tasks() if own else tasks
    now = time.time()
    patches = {}
    for t in tasks:
        if not task_is_stale(t, now):
            continue
        patches[t.get("id")] = {
            "state": "idle",
            "last_run_status": "aborted",
            "last_run_ts": t.get("started_at") or now,
            "last_output": L("запуск прерван (завершился демон или дочерний процесс)",
                             "run was interrupted (daemon or child process died)"),
            "run_pid": None,
            "started_at": None,
        }
        t.update(patches[t.get("id")])
    if patches:
        if own:
            with tasks_lock():
                disk = load_tasks()
                changed = False
                for t in disk:
                    patch = patches.get(t.get("id"))
                    # Re-check against what is on disk right now: a worker may
                    # have finished while this tick was inspecting its snapshot.
                    if not patch or not task_is_stale(t, now):
                        continue
                    t.update(patch)
                    changed = True
                if changed:
                    save_tasks(disk)
        log(f"Reaped stale running marker(s): {', '.join(str(i) for i in patches)}")
    return list(patches)


def wake_antigravity_app():
    if not AGY_APPLICATION_ID:
        log("Cannot wake app: application id was not supplied or derived from PREFIX")
        return
    log("Waking Antigravity activity to foreground...")
    command = [
        "am", "start", "-a", "android.intent.action.MAIN",
        "-c", "android.intent.category.LAUNCHER", "-p", AGY_APPLICATION_ID
    ]
    try:
        if os.path.isfile(RISH_BIN):
            subprocess.run(
                [RISH_BIN, "-c", " ".join(shlex.quote(part) for part in command)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15
            )
        else:
            subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    except Exception as e:
        log(f"Cannot wake app: {e}")


def _run_task_worker(task):
    task_id = task.get("id", "unknown")
    name = task.get("name", task_id)
    command = task.get("command", "")
    prompt = task.get("prompt", "")
    project = task.get("project")
    convo_id = task.get("conversation_id")
    wake_app = task.get("wake_app", False)

    with RUNNING_LOCK:
        RUNNING_JOBS.add(task_id)

    log(f"Worker started for task [{name}] (ID: {task_id})")

    # If prompt is set but command is not, generate a notification + prompt action
    if not command and prompt:
        trigger_title = L("Запуск задачи ИИ", "AI Task Trigger")
        command = f"agy-notify post -t {shlex.quote(trigger_title)} -m {shlex.quote(prompt[:100])}"

    start_t = time.time()
    success = False
    output = ""
    duration = 0
    try:
        # Persist the running marker BEFORE the command starts, so the UI can
        # tell a live run from a finished one instead of guessing from a
        # timestamp that only appears at the end. run_pid starts as the daemon
        # (a marker that is at least alive) and is replaced by the real child
        # pid below, which is what stale detection has to look at.
        patch_tasks({task_id: {
            "state": "running",
            "started_at": start_t,
            "run_pid": os.getpid(),
        }})
        notify(L("Демон Antigravity", "Antigravity Daemon"),
               L(f"Выполняется задача: {name}", f"Running task: {name}"),
               tag=f"task_{task_id}")

        env = os.environ.copy()
        env["PATH"] = f"{PREFIX}/bin:{env.get('PATH', '')}"
        env["HOME"] = HOME
        if convo_id:
            env["AGY_CONVERSATION_ID"] = convo_id
        if project:
            env["AGY_PROJECT_DIR"] = project

        cwd = project if (project and os.path.isdir(project)) else HOME
        timeout = int(task.get("timeout_sec", 600))

        # start_new_session puts the shell and everything it spawns in one
        # process group. A plain timeout would kill only the shell and leave
        # children holding the pipes open, which looked like a hung task.
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            cwd=cwd,
            start_new_session=True,
            executable=BASH_BIN if os.path.isfile(BASH_BIN) else "/system/bin/sh",
        )
        try:
            patch_tasks({task_id: {"run_pid": proc.pid}})
        except Exception as e:
            log(f"Could not record child pid for [{name}]: {e}")
        try:
            output = (proc.communicate(timeout=timeout)[0] or "").strip()
            success = (proc.returncode == 0)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                time.sleep(1)
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except OSError:
                pass
            try:
                output = (proc.communicate(timeout=10)[0] or "").strip()
            except Exception:
                output = ""
            output = (output + "\n" + L("Задача прервана по таймауту.",
                                        "Task timed out.")).strip()
            log(f"Task [{name}] timed out after {timeout}s; process group killed.")
    except Exception as e:
        output = L(f"Ошибка выполнения: {e}", f"Execution error: {e}")
        log(f"Task [{name}] failed: {e}")
    finally:
        duration = int(time.time() - start_t)
        status_str = "Completed successfully" if success else "Failed"
        status_ui = (L("Задача выполнена успешно", "Task Completed successfully") if success
                     else L("Задача завершилась с ошибкой", "Task Failed"))
        log(f"Task [{name}] {status_str} in {duration}s. Output summary: {output[:200]}")
        try:
            notify(
                f"{status_ui}: {name}",
                L(f"Выполнено за {duration} с. {output[:120]}",
                  f"Finished in {duration}s. {output[:120]}"),
                tag=f"task_done_{task_id}",
            )
        except Exception as e:
            log(f"Notification failed, continuing: {e}")
        try:
            patch_tasks({task_id: {
                "state": "idle",
                "last_run_status": "success" if success else "failed",
                "last_run_duration": duration,
                "last_run_ts": time.time(),
                "last_output": output[:1000],
                "run_pid": None,
                "started_at": None,
            }})
        except Exception as e:
            log(f"Error saving task completion status: {e}")
        if wake_app:
            try:
                wake_antigravity_app()
            except Exception as e:
                log(f"Wake failed: {e}")
        with RUNNING_LOCK:
            RUNNING_JOBS.discard(task_id)


def execute_action_async(task):
    task_id = task.get("id", "unknown")
    with RUNNING_LOCK:
        if task_id in RUNNING_JOBS:
            log(f"Task [{task_id}] already running. Skipping overlap.")
            return False
        # Reserve the id in the same critical section as the check, otherwise
        # two ticks can both pass the check and run the task twice.
        RUNNING_JOBS.add(task_id)
    try:
        TASK_EXECUTOR.submit(_run_task_worker, task)
        return True
    except Exception as e:
        with RUNNING_LOCK:
            RUNNING_JOBS.discard(task_id)
        log(f"Could not schedule task [{task_id}]: {e}")
        return False
