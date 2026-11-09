' 隐藏窗口启动手机网关（使用 PATH 里的 node.exe）
Dim sh, fso, here
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "node.exe """ & here & "\server.mjs""", 0, False
