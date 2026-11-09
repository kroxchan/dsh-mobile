' 从 Cloudflared 服务注册项读取 tunnel token，隐藏窗口启动隧道
Dim sh, imagePath, token, regex, matches
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("TUNNEL_CONNECTION_COUNT") = "4"
imagePath = sh.RegRead("HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared\ImagePath")
Set regex = New RegExp
regex.Pattern = "--token\s+([^\s""]+)"
regex.IgnoreCase = True
Set matches = regex.Execute(imagePath)
If matches.Count = 0 Then
  WScript.Quit 1
End If
token = matches(0).SubMatches(0)
sh.Run """C:\Program Files (x86)\cloudflared\cloudflared.exe"" tunnel --protocol http2 --edge-ip-version 4 --metrics localhost:20336 run --token " & token, 0, False
