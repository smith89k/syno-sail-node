# SynoSail Node - Synology Node.js Docker Configuration

SynoSail Node is the Node.js sister of [SynoSail](https://github.com/smith89k/syno-sail). It drops a ready-made Docker setup into any Node.js project so you can deploy it on a **Synology NAS** with a GUI Docker manager such as **Dockhand**, **Dockge**, **Arcane** or **Portainer**.

## Why this package?

It follows the same steps as SynoSail: build the image on GitHub, paste the stack into your Docker manager, give the `data` folder the right permissions, and start it.

---

## Step 1: Installation & Building (On Your Local Machine / CI)

In your Node.js project's folder, run:

```bash
npx github:smith89k/syno-sail-node install
```

**If you are updating** and want the latest versions of the files (this overwrites any changes you made to them), run:

```bash
npx github:smith89k/syno-sail-node install --force
```

This copies the following into your project root:
- `Dockerfile` (builds your image: installs packages, runs your `build` script if you have one, then a small production image that runs `npm start` as a non-root user)
- `docker-compose.yml` (the stack you deploy on Synology)
- `docker/scripts/` (the start-up script and the backup script)
- `.env.docker.example` (template for your production settings; `<APP_NAME>`, `<DB_NAME>` and `<GITHUB_USER>` are filled in from `package.json` or the git remote when they can be found)
- `.dockerignore`
- `.github/workflows/docker-build.yml` (builds and pushes your image to GitHub Container Registry on every push to `main`)

### What your project needs

- A `start` script in `package.json` (the container runs `npm start`).
- The app must listen on the port in the `PORT` environment variable (default `3000`).
- Optional: a `build` script (run while building the image) and a `migrate` script (run every time the container starts, after the database is ready).
- Anything the app must keep (uploads, files) should be saved under `/app/data`; that folder lives on the NAS and is included in backups.

### Build & Push Your Image

The included GitHub Actions workflow builds the image and pushes it to GitHub Container Registry (GHCR) when you push to `main`. It uses a `GHCR_PAT` repository secret (a Personal Access Token with `write:packages`) if you add one, otherwise the repository's own token.

Alternatively, build locally:

```bash
docker build -t ghcr.io/<GITHUB_USER>/<APP_NAME>:latest -f Dockerfile .
docker push ghcr.io/<GITHUB_USER>/<APP_NAME>:latest
```

---

## Step 2: Preparing Dockhand (On Your Synology NAS)

1. **Create the Stack (do not deploy yet!)**
   Open Dockhand (or Dockge/Arcane/Portainer) and create a new Stack.
   Paste your `docker-compose.yml` into the editor.
   Paste `.env.docker.example` into the `.env` editor and fill it in: `CONTAINER_NAME`, `CONTAINER_REGISTRY_IMAGE`, `APP_PORT`, `APP_URL`, `DB_DATABASE`, `DB_PASSWORD`.
   **Save the stack, but do NOT start it.**

2. **Set Synology Folder Permissions (crucial)**
   - Open **File Station** and go to the folder where the stack was saved (for example `/volume1/docker/dockhand/stacks/<ENVIRONMENT_OR_USER>/<PROJECT_NAME>/`).
   - Create a folder named `data` inside it.
   - Right-click `data` -> **Properties** -> **Permission**: give **Everyone** `Read & Write`, and tick "Apply to this folder, sub-folders and files".

3. **Deploy the Stack**
   Go back to your Docker manager and click **Start/Deploy**. Open `http://<NAS_IP>:<APP_PORT>`.

### What the Services Do

- **`init`**: a short-lived container that runs first. It creates the `data/app`, `data/mariadb` and `data/scripts` folders and copies the backup script out of your image onto the NAS.
- **`db`**: MariaDB for your application (host `db`, port `3306`).
- **`app`**: your Node.js app. It waits for the database, runs `npm run migrate` if you have that script, then `npm start`. A health check opens `HEALTH_PATH` (default `/`) to make sure it is answering.

### Why `security_opt: seccomp=unconfined`?

Synology DSM runs Docker with an older default seccomp profile that blocks system calls newer images use (such as `clone3`), which makes containers crash on start. `seccomp=unconfined` lets them run normally on the NAS.

### Reaching the app from outside your home

Forward `APP_PORT` on your router, or use DSM **Control Panel -> Login Portal -> Advanced -> Reverse Proxy**. If your app uses WebSockets (live updates, chat, games), open the rule's **Custom Header** tab and click **Create -> WebSocket**, or the page will load but the live connection will fail.

---

## Example Stack (copy & paste into Dockhand)

A complete stack for a Node.js app, served on port `8083` of your NAS. The `docker-compose.yml` and `.env.docker.example` below are exactly what `npx github:smith89k/syno-sail-node install` writes. Replace every `<UPPERCASE>` placeholder in the `.env` with your own value (see the table below); the `docker-compose.yml` needs no changes.

| Placeholder | What to put there |
|---|---|
| `<GITHUB_USER>` | Your GitHub user name, in lowercase. |
| `<APP_NAME>` | Your app's GitHub repository name, in lowercase. The workflow publishes the image as `ghcr.io/<GITHUB_USER>/<APP_NAME>`. |
| `<NAS_IP>` | Your NAS's address on your network (DSM **Control Panel -> Network -> Network Interface**). |
| `<DB_NAME>` | The database name, e.g. your app name with `_` instead of `-`. |
| `<DB_PASSWORD>` | A strong password for the database's `root` user. |
| `<ENVIRONMENT_OR_USER>`, `<PROJECT_NAME>` | The folders your Docker manager saved the stack in. |

<details>
<summary><strong>docker-compose.yml</strong> (paste into the stack editor)</summary>

```yaml
services:
  init:
    image: ${CONTAINER_REGISTRY_IMAGE:-ghcr.io/<GITHUB_USER>/<APP_NAME>:latest}
    container_name: ${CONTAINER_NAME:-node-app}-init
    user: "0:0"
    entrypoint: ["sh", "-c",
                 "mkdir -p /mnt/stack/app &&
                 mkdir -p /mnt/stack/mariadb &&
                 mkdir -p /mnt/stack/scripts &&
                 cp -rf /app/docker/scripts/. /mnt/stack/scripts/ &&
                 sed -i 's/\r$$//' /mnt/stack/scripts/*.sh &&
                 chown -R 1000:1000 /mnt/stack/app"]
    volumes:
      - ./data:/mnt/stack
    restart: "no"
    security_opt:
      - seccomp:unconfined

  db:
    image: mariadb:11.4
    container_name: ${CONTAINER_NAME:-node-app}-db
    restart: unless-stopped
    environment:
      - MARIADB_DATABASE=${DB_DATABASE:-app}
      - MARIADB_ROOT_PASSWORD=${DB_PASSWORD:-}
      - MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1
      - MARIADB_AUTO_UPGRADE=1
    volumes:
      - ./data/mariadb:/var/lib/mysql
    depends_on:
      init:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--innodb_initialized"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 45s
    mem_limit: 768m
    memswap_limit: 1280m
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "2"
    security_opt:
      - seccomp:unconfined

  app:
    image: ${CONTAINER_REGISTRY_IMAGE:-ghcr.io/<GITHUB_USER>/<APP_NAME>:latest}
    container_name: ${CONTAINER_NAME:-node-app}-app
    restart: unless-stopped
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - PORT=${PORT:-3000}
      - TZ=${APP_TIMEZONE:-UTC}
      - APP_URL=${APP_URL:-}
      - HEALTH_PATH=${HEALTH_PATH:-/}
      - DB_HOST=${DB_HOST:-db}
      - DB_PORT=${DB_PORT:-3306}
      - DB_DATABASE=${DB_DATABASE:-app}
      - DB_USERNAME=${DB_USERNAME:-root}
      - DB_PASSWORD=${DB_PASSWORD:-}
    ports:
      - "${APP_PORT:-8083}:${PORT:-3000}"
    volumes:
      # anything the app saves under /app/data survives updates and is backed up
      - ./data/app:/app/data
    depends_on:
      init:
        condition: service_completed_successfully
      db:
        condition: service_healthy
    mem_limit: 384m
    memswap_limit: 768m
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "2"
    security_opt:
      - seccomp:unconfined
```

</details>

<details>
<summary><strong>.env.docker.example</strong> (paste into the .env editor, then fill in the placeholders)

```bash
# Replace every <UPPERCASE> placeholder (see the README's placeholder table).
CONTAINER_NAME=<APP_NAME>
CONTAINER_REGISTRY_IMAGE=ghcr.io/<GITHUB_USER>/<APP_NAME>:latest

NODE_ENV=production
# the port on the NAS people open, and the port the app listens on inside
APP_PORT=8083
PORT=3000
APP_TIMEZONE=Asia/Phnom_Penh
# the address people use to reach the app
APP_URL=http://<NAS_IP>:8083
# the page the health check opens to see the app is alive
HEALTH_PATH=/

DB_HOST=db
DB_PORT=3306
DB_DATABASE=<DB_NAME>
DB_USERNAME=root
DB_PASSWORD=<DB_PASSWORD>
```

</details>

---

## Step 3: Setting up Backups via DSM Task Scheduler

`docker/scripts/backup.sh` dumps the database and compresses `data/app`, keeping 7 days of backups. Backups are saved outside the stack folder, in `/volume1/docker/backups/<PROJECT_NAME>`, so removing the stack does not remove them. Set `BACKUP_DIR` in `.env` to change that.

1. Open **Control Panel** -> **Task Scheduler** -> **Create** -> **Scheduled Task** -> **User-defined script**.
2. **General**: name it "Node Backup", user `root`.
3. **Schedule**: daily at 2:00 AM.
4. **Task Settings** -> "Run command":

```bash
cd /volume1/docker/dockhand/stacks/<ENVIRONMENT_OR_USER>/<PROJECT_NAME>
DEPLOY_PATH=$(pwd) sh ./data/scripts/backup.sh
```

## License

The MIT License (MIT).
