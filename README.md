# Asteroid Apocalypse Defenders

Real-time multiplayer asteroid blaster.

## Getting Started

### Development

```bash
make setup-dev   # Install dependencies (includes nodemon for hot-reload)
make dev         # Start the dev server with hot-reload on port 3099
```

The game will be available at `http://localhost:3099/asteroid-apocalypse-defenders/`.

### Production (Docker)

```bash
make setup-prod  # Build and start containers (game server + nginx reverse proxy)
make stop        # Stop and remove containers
```

The game will be available at `http://<your-host>:8099/asteroid-apocalypse-defenders/`.