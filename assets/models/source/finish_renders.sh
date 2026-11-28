#!/usr/bin/env bash
# Render whatever the site still needs (tour panoramas, window views, phone sizes, hero shots), then re-audit.
#
#   bash assets/models/source/finish_renders.sh          # from the repo root
#
# Safe to stop and re-run at any point: assets/images/tour_audit.py decides what is missing or stale
# (make-style: an output older than its sources is redone), so nothing is rendered twice and nothing
# half-written survives. Keeps Windows from idle-sleeping while it runs.
# To stop it, kill the whole tree (stopping only bash leaves Blender and the next steps running):
#   taskkill //F //T //PID <winpid printed at start>
set -u
cd "$(dirname "$0")/../../.."
B="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
LOGS="assets/models/env/logs"  # gitignored with env/
mkdir -p "$LOGS"
SELF=$(cat /proc/$$/winpid 2>/dev/null || echo $$)
echo "finish_renders started $(date '+%F %T') (winpid $SELF)"

# hold off idle sleep for as long as this script lives
powershell -NoProfile -Command "Add-Type -Namespace W -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; [W.P]::SetThreadExecutionState([uint32]2147483649) | Out-Null; while (Get-Process -Id $SELF -ErrorAction SilentlyContinue) { Start-Sleep 30 }" &
AWAKE=$!
trap 'kill $AWAKE 2>/dev/null' EXIT

PLAN=$(python assets/images/tour_audit.py --plan) || { echo "audit failed"; exit 1; }
echo "$PLAN" | sed 's/^/  plan: /'

tours() { # log-name, extra args...
  local name=$1; shift
  echo "=== $name $(date +%T)"
  "$B" -b --factory-startup -P assets/models/source/tours.py -- --seed assets/seed/project.json \
    --out apps/web/public/tours --quality final "$@" > "$LOGS/$name.log" 2>&1
  grep -a "^Saved\|Traceback\|Error:" "$LOGS/$name.log"
}

# stale window views: delete so tours.py re-renders them on the next launch that needs them
for e in $(echo "$PLAN" | awk '$1 == "ENV" {print $2}'); do
  rm -f "assets/models/env/$e.exr" && echo "window view $e.exr will be re-rendered"
done

ALL=$(echo "$PLAN" | awk '$1 == "RENDER" && $3 == "ALL" {print $2}' | paste -sd, -)
[ -n "$ALL" ] && tours "all_${ALL//,/_}" --only "$ALL"
echo "$PLAN" | awk '$1 == "RENDER" && $3 != "ALL" {print $2, $3}' | while read -r g ids; do
  tours "$g" --only "$g" --stops "$ids"
done

echo "=== phone sizes $(date +%T)"
python assets/images/tour_sizes.py

HERO=$(python assets/images/tour_audit.py --plan | awk '$1 == "HERO" {print $2}')
if [ -n "$HERO" ]; then
  echo "=== hero $HERO $(date +%T)"
  "$B" -b --factory-startup -P assets/models/source/cinematic.py -- --seed assets/seed/project.json \
    --out apps/web/public/cinematic --only "$HERO" > "$LOGS/hero.log" 2>&1
  grep -a "^RENDERED\|^Saved\|Traceback\|Error:" "$LOGS/hero.log"
fi

echo "=== audit $(date +%T)"
python assets/images/tour_audit.py && echo "=== done $(date +%T)" || echo "=== incomplete $(date +%T): re-run this script"
