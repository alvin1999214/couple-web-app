#!/usr/bin/env python3
"""Teletubbyland application entry point."""

from http.server import ThreadingHTTPServer

from ourspace.config import APP_NAME, PORT, STATIC_DIR
from ourspace.database import Database
from ourspace.http import create_handler
from ourspace.router import Router


def create_server(port: int = PORT) -> ThreadingHTTPServer:
    database = Database()
    migration = database.initialize()
    if migration.applied_versions:
        versions = ", ".join(str(version) for version in migration.applied_versions)
        print(f"Database migrations applied: {versions} (schema v{migration.current_version})")
    if migration.backup_path:
        print(f"Pre-migration backup: {migration.backup_path}")
    handler = create_handler(Router(database), STATIC_DIR)
    return ThreadingHTTPServer(("0.0.0.0", port), handler)


def main() -> None:
    server = create_server()
    print(f"{APP_NAME} is ready at http://localhost:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
