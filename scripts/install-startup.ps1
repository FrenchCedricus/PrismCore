<#
  Lance PrismCore au démarrage de la session Windows, réduit dans la zone de notification.

  Crée un raccourci "PrismCore.lnk" dans le dossier Démarrage de l'utilisateur (shell:startup).
  Aucun droit administrateur, aucun service, aucune tâche planifiée : supprimer le raccourci suffit à annuler.

  Usage :  npm run startup:install
           powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 [-Mode app|daemon]

  -Mode app    (défaut) application complète, fenêtre masquée (--hidden)
  -Mode daemon moteur seul, sans interface (applique config.json) via wscript, sans console visible
#>
param([ValidateSet('app', 'daemon')] [string]$Mode = 'app')

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'PrismCore.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)

if ($Mode -eq 'app') {
  $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electron)) { throw "Electron introuvable ($electron). Lance d'abord : npm install" }
  $lnk.TargetPath = $electron
  $lnk.Arguments = "`"$root`" --hidden"
  $lnk.IconLocation = "$electron,0"
} else {
  $node = (Get-Command node -ErrorAction Stop).Source
  $vbs = Join-Path $root 'scripts\run-daemon-hidden.vbs'
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = "`"$vbs`" `"$node`" `"$root`""
}
$lnk.WorkingDirectory = "$root"
$lnk.Description = 'PrismCore - éclairage RGB local'
$lnk.WindowStyle = 7 # réduit
$lnk.Save()

Write-Host "Raccourci de démarrage créé : $lnkPath" -ForegroundColor Green
Write-Host "Mode : $Mode. Pour annuler : npm run startup:uninstall"
