<#
.SYNOPSIS
    Spiegelt die alte futuresthinking.eu-Seite (2020, one.com) in einen
    zeitgestempelten lokalen Ordner — VOR der DNS-Migration zu Cloudflare.

.DESCRIPTION
    Backup-Pflicht aus DEPLOY-ANLEITUNG / backend-architektur.md §9:
    bevor die Nameserver auf Cloudflare zeigen, muss die alte Seite gesichert sein.

    Reihenfolge der Verfahren (das erste verfuegbare gewinnt):
      1) httrack   — bestes vollstaendiges Website-Mirroring, falls installiert.
      2) wget      — `--mirror` (z.B. via Git-Bash / WSL / choco install wget).
      3) Fallback  — iteratives Invoke-WebRequest (breadth-first Crawl,
                     gleiche Domain, begrenzte Tiefe) ohne externe Tools.

    Idempotent: jeder Lauf legt einen NEUEN, zeitgestempelten Ordner an,
    ueberschreibt nie ein bestehendes Backup.

.PARAMETER Url
    Start-URL. Default: https://futuresthinking.eu

.PARAMETER OutRoot
    Zielwurzel fuer Backups. Default: .\backups

.PARAMETER MaxDepth
    Nur fuer den Invoke-WebRequest-Fallback: maximale Link-Tiefe. Default: 3.

.EXAMPLE
    pwsh ./scripts/backup-oldsite.ps1
.EXAMPLE
    pwsh ./scripts/backup-oldsite.ps1 -Url https://futuresthinking.eu -MaxDepth 4
#>
[CmdletBinding()]
param(
    [string]$Url = "https://futuresthinking.eu",
    [string]$OutRoot = (Join-Path $PSScriptRoot "..\backups"),
    [int]$MaxDepth = 3
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$stamp  = Get-Date -Format "yyyy-MM-dd_HHmmss"
$host_  = ([uri]$Url).Host
$target = Join-Path $OutRoot ("{0}_{1}" -f $host_, $stamp)
New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host "==> Backup von $Url"
Write-Host "==> Ziel:       $target"

function Test-Tool([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# --- 1) httrack -----------------------------------------------------------
if (Test-Tool "httrack") {
    Write-Host "==> Verwende httrack (vollstaendiger Mirror)"
    & httrack $Url -O $target "+*.$host_/*" --robots=0 --quiet
    Write-Host "==> Fertig (httrack). Backup unter: $target"
    return
}

# --- 2) wget --mirror -----------------------------------------------------
if (Test-Tool "wget") {
    Write-Host "==> Verwende wget --mirror"
    Push-Location $target
    try {
        & wget --mirror --convert-links --adjust-extension `
               --page-requisites --no-parent `
               --domains $host_ `
               -e robots=off `
               $Url
    } finally {
        Pop-Location
    }
    Write-Host "==> Fertig (wget). Backup unter: $target"
    return
}

# --- 3) Fallback: iteratives Invoke-WebRequest ----------------------------
Write-Host "==> Weder httrack noch wget gefunden — nutze Invoke-WebRequest-Fallback."
Write-Host "    (Fuer ein wirklich vollstaendiges Archiv: 'choco install httrack' oder 'choco install wget'.)"

$base    = [uri]$Url
$visited = New-Object System.Collections.Generic.HashSet[string]
# Queue aus Tupeln (url, depth)
$queue   = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue([pscustomobject]@{ Url = $Url; Depth = 0 }) | Out-Null

function Save-Response([string]$pageUrl, $resp) {
    $u = [uri]$pageUrl
    $path = $u.AbsolutePath
    if ([string]::IsNullOrWhiteSpace($path) -or $path.EndsWith("/")) {
        $path = ($path.TrimEnd("/")) + "/index.html"
    }
    if (-not [System.IO.Path]::HasExtension($path)) {
        $path = $path + "/index.html"
    }
    $rel  = $path.TrimStart("/")
    $dest = Join-Path $target $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    # $resp.Content ist bei HTML/Text ein String (kein byte[]) — RawContentStream liefert
    # die rohen Bytes robust fuer Text UND Binaer (Bilder/CSS/JS).
    $bytes = $resp.RawContentStream.ToArray()
    [System.IO.File]::WriteAllBytes($dest, $bytes)
    Write-Host ("    gespeichert: {0}" -f $rel)
}

while ($queue.Count -gt 0) {
    $item = $queue.Dequeue()
    $cur  = $item.Url
    $depth = [int]$item.Depth

    if ($visited.Contains($cur)) { continue }
    [void]$visited.Add($cur)

    try {
        $resp = Invoke-WebRequest -Uri $cur -UseBasicParsing -TimeoutSec 30
    } catch {
        Write-Warning ("    Fehler bei {0}: {1}" -f $cur, $_.Exception.Message)
        continue
    }

    try { Save-Response $cur $resp }
    catch { Write-Warning ("    Speichern fehlgeschlagen {0}: {1}" -f $cur, $_.Exception.Message); continue }

    if ($depth -ge $MaxDepth) { continue }

    # Links + Asset-Referenzen einsammeln (gleiche Domain)
    $hrefs = @()
    try { $hrefs += ($resp.Links | Where-Object { $_.href } | ForEach-Object { $_.href }) } catch {}
    # zusaetzlich src/href aus dem Roh-HTML (Bilder, CSS, JS)
    $raw = [System.Text.Encoding]::UTF8.GetString($resp.Content)
    $matches = [regex]::Matches($raw, '(?:href|src)\s*=\s*["'']([^"''#]+)["'']')
    foreach ($m in $matches) { $hrefs += $m.Groups[1].Value }

    foreach ($h in ($hrefs | Select-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($h)) { continue }
        if ($h -match '^(mailto:|tel:|javascript:|data:)') { continue }
        try { $abs = [uri]::new($base, $h).AbsoluteUri } catch { continue }
        $absHost = ([uri]$abs).Host
        if ($absHost -ne $host_) { continue }   # nur gleiche Domain
        $abs = $abs.Split("#")[0]
        if (-not $visited.Contains($abs)) {
            $queue.Enqueue([pscustomobject]@{ Url = $abs; Depth = $depth + 1 }) | Out-Null
        }
    }
}

Write-Host "==> Fertig (Invoke-WebRequest-Fallback). Backup unter: $target"
Write-Host "==> Hinweis: Der Fallback ist eine Best-Effort-Sicherung. Fuer ein"
Write-Host "    archivreines 1:1-Abbild httrack/wget verwenden (siehe oben)."
