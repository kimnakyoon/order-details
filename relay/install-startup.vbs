' Register the relay to start on logon (current user only, no admin needed).
' Creates: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\mango-relay.lnk
Dim sh, fso, dir, lnkPath, lnk
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
lnkPath = sh.SpecialFolders("Startup") & "\mango-relay.lnk"

Set lnk = sh.CreateShortcut(lnkPath)
lnk.TargetPath = dir & "\relay-hidden.vbs"
lnk.WorkingDirectory = dir
lnk.Description = "The.Mango order-detail relay (127.0.0.1:8787)"
lnk.Save

WScript.Echo "Registered:" & vbCrLf & lnkPath & vbCrLf & vbCrLf & "-> " & dir & "\relay-hidden.vbs"
