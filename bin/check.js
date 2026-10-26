#!/bin/bash
set -euo pipefail

# ── Konfiguration ─────────────────────────────────────────────────────────────
SONARCLOUD_PROJECT="latz_shush"
JS_SOURCES="background.js popup.js"

SONAR_TOKEN="${SONAR_TOKEN:-}"
if [ -f .env ]; then
    SONAR_TOKEN=$(grep -E '^SONAR_TOKEN=' .env | cut -d= -f2 | tr -d '\r\n')
fi

# ── Optionen ──────────────────────────────────────────────────────────────────
NON_INTERACTIVE=false
RUN_SONAR=false
for ARG in "$@"; do
    [[ "$ARG" == "-y" || "$ARG" == "--yes" ]] && NON_INTERACTIVE=true
    [[ "$ARG" == "--sonar" ]] && RUN_SONAR=true
done

# ── Hilfsfunktionen ───────────────────────────────────────────────────────────
BW=62

_box_top()   { printf '╔%s╗\n' "$(printf '═%.0s' $(seq 1 $BW))"; }
_box_sep()   { printf '╠%s╣\n' "$(printf '═%.0s' $(seq 1 $BW))"; }
_box_bot()   { printf '╚%s╝\n' "$(printf '═%.0s' $(seq 1 $BW))"; }
_box_row()   { printf "║%-${BW}s║\n" "$1"; }
_box_title() { local pad=$(( (BW - ${#1}) / 2 )); _box_row "$(printf "%${pad}s%s" "" "$1")"; }
_box_rule()  { _box_row "$(printf "  %5s  %s" "$1" "$2")"; }

_n() { [[ "$1" =~ ^[0-9]+$ ]] && echo "$1" || echo "0"; }

pause() {
    if $NON_INTERACTIVE; then return; fi
    read -rp "  [Enter] weiter  [q] beenden: " _INPUT
    if [[ "${_INPUT,,}" == "q" ]]; then
        echo "  Abgebrochen."; exit 0
    fi
}

step() { echo; echo "[$1/10] $2"; }

# ── Start ─────────────────────────────────────────────────────────────────────
echo
_box_top
_box_title "Statische Code-Analyse"
_box_sep
_box_row "  $(date '+%Y-%m-%d %H:%M:%S')"
_box_row "  Projekt : Shush! (Chrome Extension)"
_box_bot
echo

# ── 1. Vorbereitung ───────────────────────────────────────────────────────────
step 1 "Vorbereitung"
mkdir -p reports
echo "  reports/ bereit"

# ── 2. ESLint ─────────────────────────────────────────────────────────────────
step 2 "ESLint – JavaScript"
# shellcheck disable=SC2086
npx eslint --format json $JS_SOURCES > reports/eslint-report.json 2>/dev/null || true

ESLINT_ERRORS=$(jq '[.[].messages[] | select(.severity == 2)] | length' reports/eslint-report.json 2>/dev/null || echo "?")
ESLINT_WARN=$(jq   '[.[].messages[] | select(.severity == 1)] | length' reports/eslint-report.json 2>/dev/null || echo "?")
ESLINT_TOTAL=$(jq  '[.[].messages | length] | add // 0'                 reports/eslint-report.json 2>/dev/null || echo "?")

echo
_box_top
_box_title "ESLint Zusammenfassung"
_box_sep
_box_row "  Fehler    : $ESLINT_ERRORS"
_box_row "  Warnungen : $ESLINT_WARN"
_box_row "  Gesamt    : $ESLINT_TOTAL"
_box_sep
_box_row "  Anzahl  Regel"
_box_sep
jq -r '[.[].messages[].ruleId]
    | group_by(.) | map({rule: .[0], count: length})
    | sort_by(-.count)[]
    | "\(.count)\t\(.rule)"' reports/eslint-report.json 2>/dev/null \
    | while IFS=$'\t' read -r C R; do _box_rule "$C" "$R"; done || true
_box_bot
echo
pause

# ── 3. TypeScript – Typprüfung ────────────────────────────────────────────────
step 3 "tsc --checkJs – Typprüfung"
TSC_ERRORS=$(npm run --silent typecheck 2>&1 | tee reports/tsc-report.txt | grep -c 'error TS' || true)
echo "  Typfehler: $TSC_ERRORS"
echo
pause

# ── 4. web-ext lint ───────────────────────────────────────────────────────────
step 4 "web-ext lint – Manifest und Locales"
node bin/lint-ext.mjs 2>&1 | tee reports/web-ext-report.txt || true
WEBEXT_FINDINGS=$(grep -oP 'web-ext lint: \K[0-9]+' reports/web-ext-report.txt || echo "?")
echo "  Findings: $WEBEXT_FINDINGS"
echo
pause

# ── 5. Vitest – Tests ─────────────────────────────────────────────────────────
step 5 "Vitest – Unit- und Integrationstests"
npm test 2>&1 | tee reports/vitest-report.txt || true

VITEST_PASS=$(grep -oP 'Tests\s+\K[0-9]+(?= passed)' reports/vitest-report.txt || echo "0")
VITEST_FAIL=$(grep -oP '[0-9]+(?= failed)'            reports/vitest-report.txt || echo "0")
VITEST_TOTAL=$(( $(_n "$VITEST_PASS") + $(_n "$VITEST_FAIL") ))

echo
_box_top
_box_title "Vitest Zusammenfassung"
_box_sep
_box_row "  Bestanden : $VITEST_PASS"
_box_row "  Fehler    : $VITEST_FAIL"
_box_row "  Gesamt    : $VITEST_TOTAL"
_box_bot
echo
pause

# ── 6. Vitest – Coverage ──────────────────────────────────────────────────────
step 6 "Vitest – Coverage"
npm run test:coverage 2>&1 | tee reports/coverage-report.txt || true

COV_STMTS=$(grep -oP '\|\s*\K[0-9.]+(?=\s*\|)' reports/coverage-report.txt | head -1 || echo "")
if [ -z "$COV_STMTS" ]; then
    COV_STMTS=$(grep -oP '[0-9.]+(?=%)' reports/coverage-report.txt | head -1 || echo "?")
fi

echo
_box_top
_box_title "Coverage Zusammenfassung"
_box_sep
_box_row "  Statements : ${COV_STMTS}%"
_box_row "  Details    : coverage/lcov.info"
_box_bot
echo
pause

# ── 7. npm audit + Gitleaks ───────────────────────────────────────────────────
step 7 "npm audit und Gitleaks"
AUDIT_HIGH=$( (npm audit --json 2>/dev/null || true) | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8')).metadata.vulnerabilities;console.log(v.high+v.critical)" 2>/dev/null || echo "?")
echo "  npm audit (high/critical): $AUDIT_HIGH"
if command -v gitleaks >/dev/null 2>&1; then
    LEAKS=$(gitleaks detect --no-banner --report-format json --report-path reports/gitleaks-report.json >/dev/null 2>&1 && echo 0 || jq 'length' reports/gitleaks-report.json 2>/dev/null || echo "?")
    echo "  Gitleaks: $LEAKS Funde"
else
    LEAKS="-"
    echo "  gitleaks nicht installiert – übersprungen"
fi
echo
pause

# ── 8. Semgrep ────────────────────────────────────────────────────────────────
step 8 "Semgrep – Sicherheitsmuster"
if command -v semgrep >/dev/null 2>&1; then
    # PYTHONUTF8: semgrep's Python otherwise reads/writes with the Windows code page.
    PYTHONUTF8=1 semgrep scan --config p/javascript --metrics=off --json --quiet \
        background.js popup.js shared > reports/semgrep-report.json 2>/dev/null || true
    SEMGREP_FINDINGS=$(jq '.results | length' reports/semgrep-report.json 2>/dev/null || echo "?")
    echo "  Funde: $SEMGREP_FINDINGS"
else
    SEMGREP_FINDINGS="-"
    echo "  semgrep nicht installiert – übersprungen (pip install semgrep)"
fi
echo
pause

# ── 9. SonarCloud Scan (nur mit --sonar) ──────────────────────────────────────
step 9 "SonarCloud Scan"
# Opt-in: the scanner uploads to SonarCloud and, with no branch name given, replaces the
# analysis of the main branch with this working copy (including uncommitted changes).
# The CI does that for master and pull requests already.
if ! $RUN_SONAR; then
    echo "  übersprungen (mit --sonar aktivieren; die CI scannt master und PRs)"
elif [ -z "$SONAR_TOKEN" ]; then
    echo "  SONAR_TOKEN nicht gesetzt – Schritt übersprungen"
else
    npm run --silent sonar -- -Dsonar.token="$SONAR_TOKEN" 2>&1 | tail -15 || true
fi
echo
pause

# ── 10. SonarCloud Issues ──────────────────────────────────────────────────────
step 10 "SonarCloud Issues abrufen"
if [ -z "$SONAR_TOKEN" ]; then
    echo "  SONAR_TOKEN nicht gesetzt – Schritt übersprungen"
    OPEN_COUNT="?"
else
    curl -s -u "${SONAR_TOKEN}:" \
        "https://sonarcloud.io/api/issues/search?componentKeys=${SONARCLOUD_PROJECT}&resolved=false" \
        > reports/sonar-issues.json
    OPEN_COUNT=$(jq '.paging.total // .total // "?"' reports/sonar-issues.json 2>/dev/null || echo "?")
    echo "  Offene Issues: $OPEN_COUNT"

    jq -r '
        "## SonarCloud Issues\n",
        "| Severity | File | Line | Rule | Message |",
        "|----------|------|------|------|---------|",
        (.issues[] | "| \(.severity) | \(.component | split(":")[1]) | \(.line // "") | \(.rule) | \(.message | gsub("\\|"; "\\|")) |")
    ' reports/sonar-issues.json > sonar-issues.md 2>/dev/null || true
    echo "  sonar-issues.md erstellt"
fi
echo
pause

# ── Zusammenfassung ───────────────────────────────────────────────────────────
GESAMT=$(( $(_n "$ESLINT_TOTAL") + $(_n "$VITEST_FAIL") + $(_n "$TSC_ERRORS") + $(_n "$WEBEXT_FINDINGS") + $(_n "$AUDIT_HIGH") + $(_n "$SEMGREP_FINDINGS") + $(_n "$LEAKS") ))

echo
_box_top
_box_title "ANALYSE ABGESCHLOSSEN"
_box_sep
_box_row "  $(date '+%Y-%m-%d %H:%M:%S')"
_box_sep
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "Tool" "Fehler" "Warnungen" "Gesamt")"
_box_sep
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "ESLint"   "$ESLINT_ERRORS"  "$ESLINT_WARN"   "$ESLINT_TOTAL")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "Vitest"   "$VITEST_FAIL"   "$VITEST_PASS passed" "$VITEST_TOTAL")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "Coverage" ""               ""               "${COV_STMTS}%")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "tsc"      "$TSC_ERRORS"    ""               "$TSC_ERRORS")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "web-ext"  "$WEBEXT_FINDINGS" ""             "$WEBEXT_FINDINGS")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "npm audit" "$AUDIT_HIGH"   ""               "$AUDIT_HIGH")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "Gitleaks" "$LEAKS"        ""               "$LEAKS")"
_box_row "$(printf "  %-20s  %7s  %10s  %8s" "Semgrep"  "$SEMGREP_FINDINGS" ""          "$SEMGREP_FINDINGS")"
_box_sep
_box_row "$(printf "  %-20s  %28s" "Gesamt Probleme" "$GESAMT")"
_box_sep
_box_row "$(printf "  %-20s  %28s" "SonarCloud Issues" "$OPEN_COUNT offen")"
_box_bot
echo
