# SynoSail Node - Synology Node.js Docker Configuration

SynoSail Node is the Node.js sister of [SynoSail](https://github.com/smith89k/syno-sail). It drops a ready-made Docker setup into any Node.js project so you can deploy it on a **Synology NAS** with a GUI Docker manager such as **Dockhand**, **Dockge**, **Arcane** or **Portainer**.

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
- `.env.docker.example` (template for your production settings)
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
docker build -t ghcr.io/your-user/your-app:latest -f Dockerfile .
docker push ghcr.io/your-user/your-app:latest
```

---

## Step 2: Preparing Dockhand (On Synology DSM 7.x)

1. **Create the Stack (do not deploy yet!)**
   Open Dockhand (or Dockge/Arcane/Portainer) and create a new Stack.
   Paste your `docker-compose.yml` into the editor.
   Paste `.env.docker.example` into the `.env` editor and fill it in: `CONTAINER_REGISTRY_IMAGE` (your GHCR image), `APP_PORT`, `APP_URL`, `DB_PASSWORD`.
   **Save the stack, but do NOT start it.**

2. **Set Synology Folder Permissions (crucial)**
   - Open **File Station** and go to the folder where the stack was saved (for example `/volume1/docker/dockhand/stacks/<your-environment-or-user>/<your-project-name>/`).
   - Create a folder named `data` inside it.
   - Right-click `data` -> **Properties** -> **Permission**: give **Everyone** `Read & Write`, and tick "Apply to this folder, sub-folders and files".

3. **Deploy the Stack**
   Go back to your Docker manager and click **Start/Deploy**. Open `http://<your-nas>:<APP_PORT>`.

### What the Services Do

- **`init`**: a short-lived container that runs first. It creates the `data/app`, `data/mariadb` and `data/scripts` folders and copies the backup script out of your image onto the NAS.
- **`db`**: MariaDB for your application (host `db`, port `3306`).
- **`app`**: your Node.js app. It waits for the database, runs `npm run migrate` if you have that script, then `npm start`. A health check opens `HEALTH_PATH` (default `/`) to make sure it is answering.

### Why `security_opt: seccomp=unconfined`?

Synology DSM runs Docker with an older default seccomp profile that blocks system calls newer images use (such as `clone3`), which makes containers crash on start. `seccomp=unconfined` lets them run normally on the NAS.

### Playing or browsing from outside your home

Forward `APP_PORT` on your router, or use DSM **Control Panel -> Login Portal -> Advanced -> Reverse Proxy**. If your app uses WebSockets (live updates, chat, games), open the rule's **Custom Header** tab and click **Create -> WebSocket**, or the page will load but the live connection will fail.

---

## Step 3: Setting up Backups via DSM Task Scheduler

`docker/scripts/backup.sh` dumps the database and compresses `data/app`, keeping 7 days of backups. Backups are saved outside the stack folder, in `/volume1/docker/backups/<your-project-name>`, so removing the stack does not remove them. Set `BACKUP_DIR` in `.env` to change that.

1. Open **Control Panel** -> **Task Scheduler** -> **Create** -> **Scheduled Task** -> **User-defined script**.
2. **General**: name it "Node Backup", user `root`.
3. **Schedule**: daily at 2:00 AM.
4. **Task Settings** -> "Run command":

```bash
cd /volume1/docker/dockhand/stacks/<your-environment-or-user>/<your-project-name>
DEPLOY_PATH=$(pwd) sh ./data/scripts/backup.sh
```

## License

The MIT License (MIT).
