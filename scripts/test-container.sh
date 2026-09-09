#!/bin/sh
set -eu
image=ghcr.io/charliec94/diary:latest
volume=diary-ci-data
container=diary-ci
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
start() {
  docker run -d --name "$container" -v "$volume:/data" "$image" >/dev/null
  attempts=0
  until docker exec "$container" wget -q -O /dev/null http://127.0.0.1:3000/health; do
    attempts=$((attempts + 1)); if [ "$attempts" -ge 30 ]; then docker logs "$container"; exit 1; fi
    sleep 1
  done
}
start
docker exec "$container" sh -c 'test "$(awk '\''/^Uid:/{print $2}'\'' /proc/1/status)" = 99'
docker exec "$container" wget -q --spider http://127.0.0.1:3000/health
docker exec "$container" node --input-type=module -e 'const r=await fetch("http://localhost:3000/api/entries",{method:"POST",headers:{"Content-Type":"application/json","X-Journal-Request":"1"},body:JSON.stringify({title:"CI persistence fixture",content:"Container test",section:"journal",date:"2026-09-09"})});if(r.status!==201)process.exit(1)'
docker rm -f "$container" >/dev/null
start
docker exec "$container" node --input-type=module -e 'const r=await fetch("http://localhost:3000/api/entries");const s=await r.json();if(r.status!==200||s.length!==1||s[0].title!=="CI persistence fixture")process.exit(1)'
echo 'Container health, non-root app, and persistence passed.'
