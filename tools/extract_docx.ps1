# 提取 docx 纯文本（用通配符避免中文路径编码问题）
$Out = "$env:TEMP\coc_professions.txt"
$docx = Get-ChildItem 'E:\coc-rpg-game\docs\' -Filter '*.docx' | Select-Object -First 1
if (-not $docx) { Write-Error 'no docx found'; exit 1 }
$tmp = "$env:TEMP\coc_docx_extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Copy-Item $docx.FullName "$env:TEMP\docx_tmp.zip" -Force
Expand-Archive "$env:TEMP\docx_tmp.zip" -DestinationPath $tmp -Force
$xml = Get-Content "$tmp\word\document.xml" -Raw -Encoding UTF8
$text = $xml -replace '</w:p>', "`n" -replace '<w:tab[^>]*/>', '  ' -replace '<w:br[^>]*/>', "`n" -replace '<[^>]+>', ''
$text = $text -replace '&amp;','&' -replace '&lt;','<' -replace '&gt;','>' -replace '&quot;','"' -replace '&apos;',"'"
$lines = ($text -split "`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
$lines = $lines -replace "(\r?\n){3,}", "`n`n"
$lines | Out-File $Out -Encoding UTF8
Write-Output "extracted $((Get-Item $Out).Length) bytes -> $Out"
