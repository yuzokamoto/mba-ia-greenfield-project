#!/bin/sh
set -eu

/usr/bin/mcli alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

for bucket in "$S3_BUCKET" streamtube-videos-test; do
  /usr/bin/mcli mb --ignore-existing "local/$bucket"
  /usr/bin/mcli anonymous set private "local/$bucket"
done
