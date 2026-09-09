# Install Charlie — Life Journal on Unraid

## Container settings

Use `unraid/diary.xml` as the template, or enter these settings under **Docker → Add Container**. The repository's **Test and publish Diary** workflow creates the image; wait for it to succeed before pulling.

| Setting | Value |
| --- | --- |
| Name | `diary` |
| Repository | `ghcr.io/charliec94/diary:latest` |
| Network | `bridge` |
| Host port | `8083` (change if already used) |
| Container port | `3000` / TCP |
| WebUI | `http://[IP]:[PORT:3000]/` |
| Host appdata | `/mnt/user/appdata/diary` |
| Container appdata | `/data`, read/write |
| PUID / PGID | `99` / `100` |
| Timezone | `America/Los_Angeles` |
| Restart policy | `unless-stopped` |

SQLite stores writing and attachments at `/data/journal/journal.sqlite`. Tailscale state is separate at `/data/.tailscale_state`. Keep the Unraid `appdata` share on the cache pool and back it up.

To install the template manually, copy `unraid/diary.xml` to `/boot/config/plugins/dockerMan/templates-user/my-diary.xml`, then choose it in **Add Container**. Review the values before applying. If the repository is private, copy from your authenticated checkout; raw GitHub URLs may require authentication.

If GHCR reports `denied`, sign Unraid into `ghcr.io` with a GitHub token scoped to **read:packages**. Enter it through Docker's password prompt, never in a template or command argument:

```sh
docker login ghcr.io -u charliec94
```

Open `http://YOUR-UNRAID-IP:8083` to begin writing directly. There is no password screen. Anyone who can reach the app can read and edit its journal; access is controlled through your network. Local preview data and NAS data are separate.

## Tailscale fixes carried forward

The XML prefills these native Unraid settings:

| Setting | Value |
| --- | --- |
| Use Tailscale | Yes |
| Hostname | `diary`, or another unique name |
| Userspace networking | Enabled for LAN access with bridge networking |
| Serve | `Serve`, not `Funnel` |
| Serve application port | `3000` |
| State directory | `/data/.tailscale_state` |
| Exit node / SSH | Disabled |

Unraid injects its Tailscale hook; ordinary Compose does not. Authenticate through the link in the container logs. Enable MagicDNS and HTTPS in the tailnet if required.

The image permits root initialization for that hook. Its shell-safe exec-form CMD then drops the **app** to `99:100`. Startup repairs ownership of only the journal directory and SQLite files, leaving Tailscale state untouched. Do not add a global non-root `--user` override when using the hook.

The app listens on `0.0.0.0:3000`. Host `8083` is only the LAN mapping. WebUI and Serve both use the internal port `3000`, avoiding the previous mismatch. The exec-form health check avoids shell metacharacters and supports HEAD requests.

Verify from Unraid:

```sh
docker exec diary wget -q -O - http://127.0.0.1:3000/health
docker exec diary tailscale status
docker exec diary tailscale serve status
```

If Serve reports `No serve config`, restore it:

```sh
docker exec -u 0 diary tailscale serve --bg http://127.0.0.1:3000
```

Open the printed HTTPS address from your tailnet without appending `8083`. If a reverse proxy rewrites Host and saving returns `Request not allowed`, set `APP_ORIGIN` to the exact browser origin, for example `https://diary.your-tailnet.ts.net`.

After updates, check data persistence, health, Tailscale connectivity, Serve's port, and that Funnel remains disabled.

Settings checked against [Unraid documentation](https://docs.unraid.net/unraid-os/system-administration/secure-your-server/tailscale/) and [native template fields](https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix.docker.manager/include/CreateDocker.php). Actual injected-hook startup and tailnet approval still require verification on your NAS.

## Updates and Compose

Pushing `main` runs tests, builds and smoke-tests the Linux amd64 image, and publishes `latest` and `sha-<full-commit>`. In Unraid use **Check for Updates → Update**. To roll back code, select a previous `sha-...` tag; this does not revert database contents. Back up data before updates.

For a local Compose build:

```sh
cp .env.example .env
# Set DIARY_DATA_PATH=/mnt/user/appdata/diary in .env on Unraid.
docker compose up -d --build
```

For a published image, run `docker compose pull`, then `docker compose up -d --no-build`. Compose does not apply the XML's Tailscale settings.

## Backup and restore

Stop `diary`, back up the complete `/mnt/user/appdata/diary` directory, then restart. Backups contain writing, attachment bytes, any unused legacy authentication tables, and Tailscale identity; protect them as private data. Restore to the same mapped path with the container stopped. Avoid running two copies of the same Tailscale identity.

**Export writing** downloads entries and attachment metadata as JSON. It is not a full backup and excludes attachment bytes. Download individual files or use the directory backup for complete restoration.

## Upgrading to the minimal dark version

Pull the new image and keep the existing `/data` mount. No journal migration or password is required. The app no longer uses `COOKIE_SECURE`; remove that old setting if present. The Unraid/Tailscale ports and state directory are unchanged.
