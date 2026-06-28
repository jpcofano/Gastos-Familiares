$ErrorActionPreference = "Stop"
$toolsDir = "$env:USERPROFILE\tools"

Write-Host "==> Paso 1/5: Creando carpeta de tools" -ForegroundColor Cyan
if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }

Write-Host "==> Paso 2/5: Descargando JDK 21 (Temurin, sin admin)" -ForegroundColor Cyan
$api = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
$zipPath = "$toolsDir\jdk21.zip"
Invoke-WebRequest -Uri $api -OutFile $zipPath

Write-Host "==> Paso 3/5: Descomprimiendo" -ForegroundColor Cyan
Get-ChildItem $toolsDir -Directory | Where-Object { $_.Name -like 'jdk-21*' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
$javaFolder = Get-ChildItem $toolsDir -Directory | Where-Object { $_.Name -like 'jdk-21*' } | Select-Object -First 1
if (-not $javaFolder) { throw "No se encontró la carpeta jdk-21* tras descomprimir." }
$javaHome = $javaFolder.FullName
Write-Host "    Carpeta Java: $javaHome" -ForegroundColor Green

Write-Host "==> Paso 4/5: Configurando JAVA_HOME y PATH del usuario" -ForegroundColor Cyan
[Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
$cleanedPath = ($userPath -split ';' | Where-Object {
    $_ -and ($_ -notmatch 'jdk-' -and $_ -notmatch '\\java\\' -and $_ -notmatch 'jre')
}) -join ';'
[Environment]::SetEnvironmentVariable("Path", "$javaHome\bin;$cleanedPath", "User")
$env:JAVA_HOME = $javaHome
$env:Path = "$javaHome\bin;$env:Path"
Write-Host "    JAVA_HOME y PATH actualizados (solo tu user, sin admin)" -ForegroundColor Green

Write-Host "==> Paso 5/5: Verificando" -ForegroundColor Cyan
& "$javaHome\bin\java.exe" -version
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Write-Host "OK - Java 21 listo. Ya podes correr: npm run emu" -ForegroundColor Yellow