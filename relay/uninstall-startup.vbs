' Remove the logon registration created by install-startup.vbs.
Dim sh, fso, lnkPath
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
lnkPath = sh.SpecialFolders("Startup") & "\mango-relay.lnk"
If fso.FileExists(lnkPath) Then
  fso.DeleteFile lnkPath
  WScript.Echo "Removed: " & lnkPath
Else
  WScript.Echo "Not registered: " & lnkPath
End If
