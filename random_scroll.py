import pyautogui
import random
import time
import subprocess

# ========================= CONFIG =========================
pyautogui.PAUSE = 0.6
pyautogui.FAILSAFE = False

def get_open_app_names():
    script = '''
    tell application "System Events"
        set appList to name of every process whose background only is false
    end tell
    return appList
    '''
    try:
        result = subprocess.check_output(['osascript', '-e', script], text=True)
        apps = [app.strip() for app in result.strip().split(',') if app.strip()]
        exclude = ["Terminal", "iTerm", "iTerm2", "zsh", "bash"]
        return [app for app in apps if app not in exclude]
    except:
        return ["Safari", "Finder", "Notes"]  # fallback

def activate_app(app_name):
    script = f'tell application "{app_name}" to activate'
    try:
        subprocess.run(['osascript', '-e', script], check=True)
        time.sleep(1.0)
        print(f"→ Switched to: {app_name}")
    except:
        pass

def switch_tab():
    print("   → Tab switch")
    try:
        if random.random() < 0.6:
            pyautogui.hotkey('command', 'tab')
        else:
            pyautogui.hotkey('command', 'shift', ']')
        time.sleep(1.1)
    except:
        pass

def switch_same_app_window():
    print("   → Same app window switch")
    try:
        pyautogui.hotkey('command', '`')
        time.sleep(1.0)
    except:
        pass

def scroll_random():
    print("   ↓ Scrolling")
    for _ in range(random.randint(3, 9)):
        pyautogui.scroll(random.randint(-750, 750))
        time.sleep(random.uniform(0.3, 1.3))

def random_mouse_move():
    print("   ↔ Mouse move")
    try:
        w, h = pyautogui.size()
        x = random.randint(80, w - 80)
        y = random.randint(80, h - 80)
        pyautogui.moveTo(x, y, duration=random.uniform(0.4, 1.3))
    except:
        pass

# ===================== MAIN =====================

print("🚀 Continuous macOS App Chaos Started")
print("Keeps switching between your open apps smoothly")
print("Press Ctrl + C to stop\n")

try:
    while True:
        open_apps = get_open_app_names()
        
        if len(open_apps) < 2:
            print("Not enough apps open. Waiting...")
            time.sleep(6)
            continue

        # Shuffle and keep cycling through apps continuously
        random.shuffle(open_apps)
        
        # Use most of the open apps in random order
        for app in open_apps[:random.randint(4, len(open_apps))]:
            activate_app(app)
            
            # Multiple random actions inside the app
            actions = ["scroll", "tab", "mouse", "same_window"] * 2
            random.shuffle(actions)
            
            for action in actions[:random.randint(3, 6)]:
                if random.random() < 0.3:   # occasional skip
                    continue
                    
                if action == "scroll":
                    scroll_random()
                elif action == "tab":
                    switch_tab()
                elif action == "mouse":
                    random_mouse_move()
                elif action == "same_window":
                    switch_same_app_window()
                
                time.sleep(random.uniform(1.2, 3.8))
            
            # Short pause before next app switch (feels more natural)
            time.sleep(random.uniform(0.8, 2.5))

        print("→ Continuing to next random sequence...\n")

except KeyboardInterrupt:
    print("\n\nScript stopped by user (Ctrl+C)")
except Exception as e:
    print(f"Error: {e}")