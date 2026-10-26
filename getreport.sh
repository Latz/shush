curl -fsS -u "$SONAR_API_TOKEN:" "https://sonarcloud.io/api/issues/search?componentKeys=latz_shush&resolved=false&ps=500" -o sonar-issues.json
