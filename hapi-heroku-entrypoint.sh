#!/bin/bash
set -e

# Parse Heroku DATABASE_URL (postgres://user:pass@host:port/db)
# into Spring Boot properties (jdbc:postgresql://host:port/db)
if [ -n "$DATABASE_URL" ]; then
    regex="^postgres://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+)$"
    if [[ $DATABASE_URL =~ $regex ]]; then
        export SPRING_DATASOURCE_USERNAME="${BASH_REMATCH[1]}"
        export SPRING_DATASOURCE_PASSWORD="${BASH_REMATCH[2]}"
        export SPRING_DATASOURCE_URL="jdbc:postgresql://${BASH_REMATCH[3]}:${BASH_REMATCH[4]}/${BASH_REMATCH[5]}?sslmode=require"
        
        echo "Configured Spring Datasource from DATABASE_URL"
    else
        echo "DATABASE_URL present but did not match regex"
    fi
fi

# Pass execution to the CMD
exec "$@"
