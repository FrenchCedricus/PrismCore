<#
  Retire PrismCore du démarrage de Windows (raccourci du dossier Démarrage et entrée créée par l'application).
#>
$ErrorActionPreference = 'Stop'
$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'PrismCore.lnk'
if (Test-Path $lnkPath) {
  Remove-Item $lnkPath -Force
  Write-Host "Raccourci supprimé : $lnkPath" -ForegroundColor Green
} else {
  Write-Host 'Aucun raccourci PrismCore dans le dossier Démarrage.'
}

# Entrée "Exécuter" créée par l'option « Lancer au démarrage de Windows » de l'application.
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$entries = Get-ItemProperty $run -ErrorAction SilentlyContinue
foreach ($name in @('electron.app.PrismCore', 'PrismCore', 'electron.app.Electron')) {
  if ($entries.PSObject.Properties.Name -contains $name -and "$($entries.$name)" -match 'PrismCore|--hidden') {
    Remove-ItemProperty -Path $run -Name $name
    Write-Host "Entrée de registre supprimée : $name" -ForegroundColor Green
  }
}
