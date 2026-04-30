# Local Development

CollaborationAI is meant to run in a hof-os cell context. For integrated local work, let `hof-os` provide shared Postgres, Redis, and the inherited-auth JWT secret, then run this repo natively.

```sh
cd ~/repos/hof-os
make dev DEV_SUBAPP=collabai
```

In a second terminal, use the env printed by hof-os:

```sh
cd ~/repos/collaboration-ai
export HOF_ENV=dev
export HOF_SUBAPP_JWT_SECRET=<value from ~/repos/hof-os/.env>
export DATABASE_URL=postgresql://hofos:hofos@localhost:5432/collabai
export REDIS_URL=redis://localhost:6379/0
export HOF_DATA_APP_PUBLIC_URL=http://app.localhost:3000
make dev
```

This avoids split-brain data: the native CollaborationAI process uses the same database and auth context as the OS shell.
