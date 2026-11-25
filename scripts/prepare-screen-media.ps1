param(
    [string]$DeckDirectory = 'public/full-deck',
    [string]$UrlPrefix = './full-deck',
    [ValidateRange(2, 16384)][int]$MaximumDimension = 1600
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$screen = New-Item -ItemType Directory -Force (Join-Path $DeckDirectory 'screen')
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$parameters = [Drawing.Imaging.EncoderParameters]::new(1)
$parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]84)
$links = [ordered]@{}
$bytes = 0
try {
    $media = Get-ChildItem (Join-Path $DeckDirectory 'media') -File |
        Where-Object { $_.Extension -in '.jpg','.jpeg','.png' -and $_.Length -ge 350KB }
    foreach ($file in $media) {
        $source = [Drawing.Image]::FromFile($file.FullName)
        try {
            $ratio = [Math]::Min(1.0, [double]$MaximumDimension / [Math]::Max($source.Width, $source.Height))
            $alpha = [Drawing.Image]::IsAlphaPixelFormat($source.PixelFormat) -or $source.Palette.Flags -band 1
            if ($alpha -and $ratio -eq 1) { continue }
            $width = [Math]::Max(1, [int]($source.Width * $ratio))
            $height = [Math]::Max(1, [int]($source.Height * $ratio))
            $format = if ($alpha) { 'Format32bppArgb' } else { 'Format24bppRgb' }
            $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::$format)
            try {
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    if (!$alpha) { $graphics.Clear([Drawing.Color]::White) }
                    $graphics.DrawImage($source, 0, 0, $width, $height)
                } finally { $graphics.Dispose() }
                $name = if ($alpha) { $file.Name + '.png' } else { $file.Name + '.jpg' }
                $output = [IO.Path]::Combine($screen.FullName, $name)
                $buffer = [IO.MemoryStream]::new()
                try {
                    if ($alpha) { $bitmap.Save($buffer, [Drawing.Imaging.ImageFormat]::Png) }
                    else { $bitmap.Save($buffer, $jpeg, $parameters) }
                    if ([Math]::Max($width, $height) -ge 2 -and $buffer.Length -lt $file.Length * 0.75) {
                        [IO.File]::WriteAllBytes($output, $buffer.ToArray())
                        $links["$($UrlPrefix.TrimEnd('/'))/media/$($file.Name)"] = "$($UrlPrefix.TrimEnd('/'))/screen/${name}?display=2"
                        $bytes += $file.Length - $buffer.Length
                    }
                } finally { $buffer.Dispose() }
            } finally { $bitmap.Dispose() }
        } finally { $source.Dispose() }
    }
} finally { $parameters.Dispose() }
$manifest = Join-Path (Resolve-Path $DeckDirectory) 'previews.json'
$data = @{ version = 2; images = $links }
[IO.File]::WriteAllText($manifest, (ConvertTo-Json -InputObject $data), [Text.UTF8Encoding]::new($false))
"Generated $($links.Count) lighter display images ($([int]($bytes/1MB)) MB smaller than their source files)."
