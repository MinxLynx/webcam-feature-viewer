$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path (Split-Path $PSScriptRoot) 'public\icons'
$null = New-Item -ItemType Directory -Force -Path $root
foreach ($entry in @(@{Size=192;Name='icon-192.png'},@{Size=512;Name='icon-512.png'},@{Size=180;Name='apple-touch-icon.png'})) {
    $size = $entry.Size
    $bitmap = [System.Drawing.Bitmap]::new($size,$size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 512.0, $size / 512.0)
    $dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#0b181c'))
    $inner = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#153b3a'))
    $center = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#e9fff8'))
    $ring = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#71e6c6'),28)
    $ring2 = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#b9fff0'),24)
    $cross = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#71e6c6'),22)
    $cross.StartCap = $cross.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.FillRectangle($dark,0,0,512,512)
    $graphics.FillRectangle($inner,54,54,404,404)
    $graphics.DrawEllipse($ring,116,116,280,280)
    $graphics.DrawEllipse($ring2,179,179,154,154)
    $graphics.DrawLine($cross,256,78,256,178)
    $graphics.DrawLine($cross,256,334,256,434)
    $graphics.DrawLine($cross,78,256,178,256)
    $graphics.DrawLine($cross,334,256,434,256)
    $graphics.FillEllipse($center,231,231,50,50)
    $bitmap.Save((Join-Path $root $entry.Name),[System.Drawing.Imaging.ImageFormat]::Png)
    $cross.Dispose();$ring2.Dispose();$ring.Dispose();$center.Dispose();$inner.Dispose();$dark.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
