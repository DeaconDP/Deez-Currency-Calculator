Option Explicit
Dim shell, fso, root, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = root & "\scripts\serve.ps1"
If Not fso.FileExists(root & "\dist\index.html") Then
  MsgBox "The production app files are missing. Restore the dist folder or run the developer build first.", 16, "Deac's Currency Converter"
  WScript.Quit 1
End If
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
