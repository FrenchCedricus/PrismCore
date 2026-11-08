' Lance le moteur PrismCore sans fenêtre de console (mode daemon, sans interface).
' Arguments : <chemin de node.exe> <dossier du projet>
Set args = WScript.Arguments
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = args(1)
sh.Run """" & args(0) & """ --experimental-vm-modules --no-warnings """ & args(1) & "\src\daemon.js""", 0, False
