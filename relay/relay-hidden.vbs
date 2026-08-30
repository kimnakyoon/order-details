' Launch the relay with no console window. Registered in the Startup folder
' by install-startup.vbs so it comes up on logon.
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & dir & "\run-hidden.cmd""", 0, False
