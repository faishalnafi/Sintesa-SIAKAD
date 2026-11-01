# PowerShell helper untuk auto-commit dan push
param (
    [string]$Message,
    [switch]$Watch
)

if ($Watch) {
    node scripts/autocommit.mjs --watch
} elseif ($Message) {
    node scripts/autocommit.mjs $Message
} else {
    node scripts/autocommit.mjs
}
