# Running Multiple Instances

SparkyFitness runs as a single server by default, and most installs never need more. If you run more than one server against the same database (for example `server.replicas` above 1 in the Helm chart, or several server containers behind a load balancer), follow these rules.

::: warning
**Community Contribution:** Multi-instance support is community-provided. The SparkyFitness maintainers do not run more than one instance and cannot provide full review or official support for this setup.
:::

## Use identical environment variables

Every instance must run with the same environment variables. Each server reads its settings from its own environment at startup, and nothing keeps them in sync, so two instances with different values will behave differently depending on which one answers a request.

A single Kubernetes Deployment or Helm release already guarantees this. With Docker Compose or a manual setup, point every instance at the same `.env` file.

## Set the app database password explicitly

If `SPARKY_FITNESS_APP_DB_PASSWORD` is unset, each server generates its own password at startup and resets the app database role to match, which locks the other instances out of new connections. Set it explicitly (see [Database Names & Connection](./environment-variables.md#module-8-database-names-connection)).

The Helm chart handles this when Helm can read the cluster: it generates the password once, stores it in a Secret and reuses it on later upgrades. If your manifests are rendered without cluster access (for example `helm template` or Argo CD), set `server.appDatabase.password` or `server.appDatabase.existingSecret`, or enable both `externalSecrets.enabled` and `externalSecrets.appdb.enabled`, or each render generates a new password.

## Share the uploads and backup folders

Uploaded images and backups are stored on the server's disk. Every instance must mount the same uploads and backup folders, or a file uploaded through one instance will be missing on the others.

With Helm, the chart's default volumes are `ReadWriteOnce`, which usually cannot be attached to pods on different nodes. Set `server.persistence.uploads.accessMode` and `server.persistence.backup.accessMode` to `ReadWriteMany` with a StorageClass that supports it, and switch `server.strategy.type` to `RollingUpdate`. The access mode is fixed when a volume is created, so an existing install needs new volumes with its data copied over.

## What to expect during a rolling update

When you change an environment variable and redeploy one instance at a time, old and new instances run side by side for a short while. During that window:

- **Login options** (such as `SPARKY_FITNESS_DISABLE_EMAIL_LOGIN`) can differ between instances, so the login page may briefly show the old or new options depending on which instance answers.
- **The OIDC provider** from `SPARKY_FITNESS_OIDC_*` is written to the database by each instance when it starts, so whichever instance writes it last wins. In a normal rolling update that is a new instance. If an old instance restarts partway through, restart one new instance after the update finishes to put the new configuration back.

Once every instance runs the new configuration, they all agree again.

## Things that are per instance

- **Sign-in rate limits** are counted by each instance separately, so the effective limit from one IP address can be up to the configured value times the number of instances.
- **Scheduled jobs** (nightly cleanup and hourly integration syncs) currently run on every instance, so each one runs once per instance.
- **Automatic backups** also run on every instance, all writing to the same backup folder at the same moment, which can produce duplicate or damaged backups. With more than one instance, turn off automatic backups in the admin settings and back up the database (for example with the Helm chart's `databaseBackup` job or your own `pg_dump` schedule) and the uploads folder separately.
