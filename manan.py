import pyautogui
import time
import random
import subprocess
import sys

# ----------------------------------------------------------------------
# Helper: list visible macOS apps
# ----------------------------------------------------------------------
def list_open_apps() -> list[str]:
    if sys.platform != "darwin":
        print(f"macOS only – you are on {sys.platform}")
        return []

    script = 'tell application "System Events" to get name of every process whose background only is false'
    try:
        result = subprocess.run(['osascript', '-e', script],
                                capture_output=True, text=True, check=True)
        apps = [a.strip() for a in result.stdout.split(',')]
        print("\n--- Open apps ---")
        for a in apps:
            print(f" • {a}")
        print("------------------\n")
        return apps
    except Exception as e:
        print(f"Could not list apps: {e}")
        return []

# ----------------------------------------------------------------------
# Helper: bring an app to front
# ----------------------------------------------------------------------
def focus_window(app_name: str) -> None:
    if sys.platform != "darwin":
        return
    script = f'tell application "{app_name}" to activate'
    try:
        subprocess.run(['osascript', '-e', script], check=True,
                       capture_output=True, text=True)
        print(f"→ Focused: {app_name}")
    except subprocess.CalledProcessError:
        print(f"Could not focus '{app_name}' – is it running?")

# ----------------------------------------------------------------------
# Main logic
# ----------------------------------------------------------------------
def main():
    # ---- 1. Get duration ------------------------------------------------
    raw = input("Duration (e.g. 1.5h or 90m): ").strip().lower()
    if raw.endswith('h'):
        try:
            secs = float(raw[:-1]) * 3600
        except ValueError:
            print("Invalid hours"); return
    elif raw.endswith('m'):
        try:
            secs = float(raw[:-1]) * 60
        except ValueError:
            print("Invalid minutes"); return
    else:
        print("Use 'h' or 'm' suffix"); return

    # ---- 2. Show open apps ---------------------------------------------
    list_open_apps()

    # ---- 3. App names (exact names as shown by list_open_apps) ----------
    CURSOR = "Cursor"
    CHROME = "Google Chrome"

    # ---- 4. Timers ------------------------------------------------------
    start = time.time()
    last_keypress = start
    last_app_switch = start
    last_tab_switch = start
    last_mouse_move = start

    # ---- 5. Start in Chrome ---------------------------------------------
    focus_window(CHROME)
    active = "chrome"

    # ---- 6. Harmless keys that macOS always accepts --------------------
    harmless_keys = ["ctrl"]

    print(f"\nRunning for {secs/60:.1f} min – press Ctrl+C to stop.\n")

    try:
        while True:
            now = time.time()
            elapsed_total = now - start
            if elapsed_total >= secs:
                print("\nDuration finished.")
                break

            # ---------------------------------------------------------
            # 1. KEY PRESS every 5-10 s
            # ---------------------------------------------------------
            if now - last_keypress >= random.uniform(5, 10):
                key = random.choice(harmless_keys)
                pyautogui.press(key)
                print(f"Key press: {key}")
                last_keypress = now

            # ---------------------------------------------------------
            # 1.5. MOUSE MOVE every 10-20 s
            # ---------------------------------------------------------
            if now - last_mouse_move >= random.uniform(10, 20):
                dx = random.randint(-50, 50)
                dy = random.randint(-50, 50)
                pyautogui.moveRel(dx, dy, duration=0.1)
                print(f"Mouse moved by ({dx}, {dy})")
                last_mouse_move = now

            # ---------------------------------------------------------
            # 2. APP SWITCH (Chrome 15 min ↔ Cursor 10 min)
            # ---------------------------------------------------------
            if active == "chrome" and now - last_app_switch >= 15*60:
                focus_window(CURSOR)
                active = "cursor"
                last_app_switch = now
                last_tab_switch = now   # reset tab timer after switch

            elif active == "cursor" and now - last_app_switch >= 10*60:
                focus_window(CHROME)
                active = "chrome"
                last_app_switch = now
                last_tab_switch = now

            # ---------------------------------------------------------
            # 3. TAB SWITCH every 50 s (inside the active app)
            # ---------------------------------------------------------
            if now - last_tab_switch >= 50:
                if active == "chrome":
                    pyautogui.hotkey("ctrl", "tab")
                    print("Chrome → next tab")
                else:  # cursor
                    pyautogui.hotkey("ctrl", "pageup")
                    print("Cursor → previous editor")
                last_tab_switch = now

            # ---------------------------------------------------------
            # Small sleep to keep CPU low (0.5 s is more than enough)
            # ---------------------------------------------------------
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\nStopped by user.")

    print("Script finished.")


if __name__ == "__main__":
    print("Starting in 3 seconds…")
    time.sleep(3)
    main()