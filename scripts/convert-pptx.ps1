param(
    [string]$InputFile = 'data/AI_Tectonism_ZHA_CN_polished.pptx',
    [int[]]$Slides = @(11, 6, 7, 10, 13, 15, 19, 82),
    [switch]$All,
    [string]$OutputDirectory = 'public',
    [string]$MediaUrlPrefix = './media',
    [string]$DeckName = 'AI Tectonism',
    [string]$ThumbnailUrlPrefix = '',
    [switch]$ReuseMedia
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $InputFile).Path)
$assetFolder = Join-Path $OutputDirectory 'media'
New-Item -ItemType Directory -Force $assetFolder | Out-Null
$copied = @{}
$unsupported = [Collections.Generic.HashSet[string]]::new()
$themeCache = @{}
$defaultColorMap = @{ tx1 = 'dk1'; tx2 = 'dk2'; bg1 = 'lt1'; bg2 = 'lt2' }

function Read-Part($path) {
    $entry = $archive.GetEntry($path)
    if (!$entry) { return }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Relations($part) {
    $base = [Uri]::new("https://archive.invalid/$part")
    $directory, $name = $part -split '/(?=[^/]+$)', 2
    $lookup = @{}
    $document = Read-Part "$directory/_rels/$name.rels"
    foreach ($relationship in $document.DocumentElement.ChildNodes) {
        if ($relationship.TargetMode -ne 'External') {
            $lookup[$relationship.Id] = [Uri]::new($base, $relationship.Target).AbsolutePath.TrimStart('/')
        }
    }
    $lookup
}
function Copy-Media($path) {
    if (!$path -or !$path.StartsWith('ppt/media/')) { return }
    $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($extension -notin '.png','.jpg','.jpeg','.svg','.gif','.webp','.mp4','.webm','.mov','.emf','.wmf') {
        [void]$unsupported.Add($extension)
        return
    }
    if (!$copied.ContainsKey($path)) {
        $name = [IO.Path]::GetFileName($path)
        $entry = $archive.GetEntry($path)
        if (!$entry) { return }
        $metafile = $extension -in '.emf','.wmf'
        if ($metafile) { $name += '.png' }
        $destination = Join-Path $assetFolder $name
        if ($ReuseMedia -and (Test-Path -LiteralPath $destination)) {
            # The output directory already contains this source asset.
        } elseif ($metafile) {
            try { Export-Metafile $entry $destination }
            catch { [void]$unsupported.Add($extension); return }
        } else {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
        $copied[$path] = "$($MediaUrlPrefix.TrimEnd('/'))/$name"
    }
    $copied[$path]
}
function Export-Metafile($entry, $destination) {
    $data = [IO.MemoryStream]::new()
    try {
        $stream = $entry.Open()
        try { $stream.CopyTo($data) } finally { $stream.Dispose() }
        $data.Position = 0
        $picture = [Drawing.Imaging.Metafile]::new($data)
        try {
            $ratio = 2200 / [Math]::Max($picture.Width, $picture.Height)
            $bitmap = [Drawing.Bitmap]::new([Math]::Max(1, [int]($picture.Width * $ratio)), [Math]::Max(1, [int]($picture.Height * $ratio)))
            try {
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try { $graphics.DrawImage($picture, 0, 0, $bitmap.Width, $bitmap.Height) } finally { $graphics.Dispose() }
                $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
            } finally { $bitmap.Dispose() }
        } finally { $picture.Dispose() }
    } finally { $data.Dispose() }
}
function Read-Theme($relations) {
    $layout = $relations.Values | Where-Object { $_ -like 'ppt/slideLayouts/*' } | Select-Object -First 1
    $master = if ($layout) { (Relations $layout).Values | Where-Object { $_ -like 'ppt/slideMasters/*' } | Select-Object -First 1 }
    $part = if ($master) { (Relations $master).Values | Where-Object { $_ -like 'ppt/theme/*' } | Select-Object -First 1 }
    if (!$part) { $part = 'ppt/theme/theme1.xml' }
    if (!$themeCache.ContainsKey($part)) {
        $theme = Read-Part $part
        $palette = @{}
        foreach ($item in $theme.SelectNodes("//*[local-name()='clrScheme']/*")) {
            $palette[$item.LocalName] = if ($item.FirstChild.lastClr) { $item.FirstChild.lastClr } else { $item.FirstChild.val }
        }
        foreach ($family in @(@('+mn-lt','minorFont'), @('+mj-lt','majorFont'))) {
            $latin = $theme.SelectSingleNode("//*[local-name()='$($family[1])']/*[local-name()='latin']")
            if ($latin) { $palette[$family[0]] = $latin.typeface }
        }
        $themeCache[$part] = $palette
    }
    $themeCache[$part]
}
function Read-Color($parent) {
    if (!$parent) { return }
    $node = $parent.SelectSingleNode("./*[local-name()='srgbClr' or local-name()='schemeClr' or local-name()='sysClr']")
    if (!$node) { return }
    $hex = switch ($node.LocalName) {
        'srgbClr' { $node.val }
        'sysClr' { $node.lastClr }
        'schemeClr' {
            $key = $node.val
            if ($colorMap.ContainsKey($key)) { $key = $colorMap[$key] }
            $palette[$key]
        }
    }
    if ($hex -notmatch '^[a-fA-F0-9]{6}$') { return }
    $mod = if ($node.lumMod) { [double]$node.lumMod.val / 100000 } else { 1 }
    $off = if ($node.lumOff) { [double]$node.lumOff.val / 100000 } else { 0 }
    if ($mod -eq 1 -and $off -eq 0) { return "#$hex" }
    '#' + ((0,2,4 | ForEach-Object {
        $value = [Convert]::ToInt32($hex.Substring($_,2),16) * $mod + $off * 255
        ([Math]::Min(255, [Math]::Max(0, [int]$value))).ToString('x2')
    }) -join '')
}
function Alignment($align) {
    switch ($align) { 'l' {'left'} 'ctr' {'center'} 'r' {'right'} 'just' {'justify'} }
}
function Design-Units($emu) { [Math]::Round([double]$emu * 1600 / $width, 2) }
function Font-Size($hundredths) { Design-Units ([double]$hundredths * 127) }
function Text-Run($text, $props, $defaults) {
    $run = @{ text = $text }
    $size = if ($props.sz) { $props.sz } else { $defaults.sz }
    if ($size) { $run.size = Font-Size $size }
    $weight = if ($props.b) { $props.b } else { $defaults.b }
    $run.weight = if ($weight -eq '1') { 700 } else { 400 }
    $italic = if ($props.i) { $props.i } else { $defaults.i }
    $run.italic = $italic -eq '1'
    $color = if ($props) { Read-Color $props.solidFill }
    if (!$color -and $defaults) { $color = Read-Color $defaults.solidFill }
    if ($color) { $run.color = $color }
    $font = if ($props.latin.typeface) { $props.latin.typeface } else { $defaults.latin.typeface }
    if ($font -and $font.StartsWith('+')) { $font = $palette[$font] }
    if ($font -and $font -notmatch '[();]') { $run.font = $font }
    if ($props.u -and $props.u -ne 'none') { $run.underline = $true }
    if ($props.cap -eq 'all') { $run.caps = $true }
    if ($props.hlinkClick) { $run.hyperlink = $true }
    $run
}
function Read-Paragraph($paragraph) {
    $result = @{ runs = @() }
    $align = Alignment $paragraph.pPr.algn
    if ($align) { $result.align = $align }
    $lineSpacing = $paragraph.pPr.lnSpc
    if ($lineSpacing.spcPct.val) { $result.leading = [double]$lineSpacing.spcPct.val / 100000 * 1.15 }
    if ($lineSpacing.spcPts.val) { $result.lineSize = Font-Size $lineSpacing.spcPts.val }
    if ($paragraph.pPr.spcBef.spcPts.val) { $result.before = Font-Size $paragraph.pPr.spcBef.spcPts.val }
    if ($paragraph.pPr.spcAft.spcPts.val) { $result.after = Font-Size $paragraph.pPr.spcAft.spcPts.val }
    $bullet = $paragraph.pPr.buChar
    if ($bullet.char) { $result.runs += @{ text = $bullet.char + ' ' } }
    foreach ($item in $paragraph.ChildNodes) {
        if ($item.LocalName -eq 'br') { $result.runs += @{ text = [string][char]10 }; continue }
        $textNode = $item.SelectSingleNode("./*[local-name()='t']")
        if ($textNode) { $result.runs += Text-Run $textNode.InnerText $item.rPr $paragraph.pPr.defRPr }
    }
    $result
}
function Read-Decoration($shape, $bounds) {
    $properties = $shape.spPr
    $preset = $properties.prstGeom.prst
    $kind = switch -Regex ($preset) {
        '^(line|straightConnector)' { 'line'; break }
        '^bentConnector' { 'elbow'; break }
        '^roundRect$' { 'rounded'; break }
        '^(ellipse|flowChartConnector)$' { 'ellipse'; break }
        default { 'rect' }
    }
    $fill = Read-Color $properties.solidFill
    if (!$fill -and !$properties.SelectSingleNode("./*[local-name()='noFill']") -and [int]$shape.style.fillRef.idx -gt 0) {
        $fill = Read-Color $shape.style.fillRef
    }
    $stroke = Read-Color $properties.ln.solidFill
    if (!$stroke -and (!$properties.ln -or !$properties.ln.SelectSingleNode("./*[local-name()='noFill']")) -and [int]$shape.style.lnRef.idx -gt 0) {
        $stroke = Read-Color $shape.style.lnRef
    }
    if (!$fill -and !$stroke) { return }
    $opacity = $properties.SelectSingleNode("./*[local-name()='solidFill']/*/*[local-name()='alpha']")
    $result = [ordered]@{}
    foreach ($key in $bounds.Keys) { $result[$key] = $bounds[$key] }
    $result.id = [guid]::NewGuid().ToString('N')
    $result.type = 'shape'
    $result.kind = $kind
    $result.label = if ($kind -in 'line','elbow') { 'Connector' } else { 'Shape' }
    $result.fill = $fill
    $result.opacity = if ($opacity) { [double]$opacity.val / 100000 } else { 1 }
    $result.stroke = $stroke
    $result.strokeWidth = if ($properties.ln.w) { Design-Units $properties.ln.w } else { 1.8 }
    $result.dashed = [bool]($properties.ln.prstDash.val -and $properties.ln.prstDash.val -ne 'solid')
    $result
}
function New-Bounds($x, $y, $w, $h, $transform) {
    [ordered]@{
        id = [guid]::NewGuid().ToString('N')
        x = [Math]::Round(100 * $x / $width, 3)
        y = [Math]::Round(100 * $y / $height, 3)
        w = [Math]::Round(100 * $w / $width, 3)
        h = [Math]::Round(100 * $h / $height, 3)
        rotation = [double]$transform.rot / 60000
        flipX = $transform.flipH -eq '1'
        flipY = $transform.flipV -eq '1'
        animation = 'none'
    }
}
function Read-TextBox($layer, $textBody, $cellProperties) {
    $paragraphs = @($textBody.SelectNodes("./*[local-name()='p']") | ForEach-Object { Read-Paragraph $_ })
    $copy = ($paragraphs | ForEach-Object { $_.runs.text -join '' }) -join [char]10
    if (!$copy.Trim()) { return }
    $layer.type = 'text'
    $layer.text = $copy
    $first = $paragraphs.runs | Where-Object { $_.text.Trim() } | Select-Object -First 1
    $layer.size = if ($first.size) { $first.size } else { Font-Size 1800 }
    $layer.weight = if ($first.weight) { $first.weight } else { 400 }
    $layer.italic = [bool]$first.italic
    $layer.align = if ($paragraphs[0].align) { $paragraphs[0].align } else { 'left' }
    $layer.color = if ($first.color) { $first.color } else { '#191b19' }
    if ($first.font) { $layer.font = $first.font }
    $layer.paragraphs = $paragraphs
    $body = $textBody.SelectSingleNode("./*[local-name()='bodyPr']")
    $layer.insets = [ordered]@{}
    foreach ($edge in @(@('left','lIns','marL',91440), @('right','rIns','marR',91440), @('top','tIns','marT',45720), @('bottom','bIns','marB',45720))) {
        $inset = if ($cellProperties -and $cellProperties.HasAttribute($edge[2])) { $cellProperties.GetAttribute($edge[2]) }
            elseif ($body -and $body.HasAttribute($edge[1])) { $body.GetAttribute($edge[1]) }
            else { $edge[3] }
        $layer.insets[$edge[0]] = Design-Units $inset
    }
    $anchor = if ($cellProperties.anchor) { $cellProperties.anchor } else { $body.anchor }
    $layer.anchor = switch ($anchor) { 'ctr' {'middle'} 'b' {'bottom'} default {'top'} }
    $layer.noWrap = $body.wrap -eq 'none'
    $layer.label = if ($cellProperties) { 'Table cell' }
        elseif ($copy -match '^(Image|Video)\s+Credit|^©') { 'Source' } else { 'Text' }
    $layer
}
function Read-Table($table, $x, $y, $w, $h) {
    $columns = @($table.SelectNodes("./*[local-name()='tblGrid']/*") | ForEach-Object { [double]$_.w })
    $rows = @($table.SelectNodes("./*[local-name()='tr']"))
    $rowHeights = @($rows | ForEach-Object { [double]$_.h })
    $widthTotal = ($columns | Measure-Object -Sum).Sum
    $heightTotal = ($rowHeights | Measure-Object -Sum).Sum
    if (!$widthTotal -or !$heightTotal) { return }
    $sx = $w / $widthTotal
    $sy = $h / $heightTotal
    $cy = $y
    for ($row = 0; $row -lt $rows.Count; $row++) {
        $cx = $x
        $cells = @($rows[$row].SelectNodes("./*[local-name()='tc']"))
        for ($col = 0; $col -lt [Math]::Min($columns.Count, $cells.Count); $col++) {
            $cell = $cells[$col]
            if ($cell.hMerge -ne '1' -and $cell.vMerge -ne '1') {
                $endColumn = [Math]::Min($columns.Count - 1, $col + [Math]::Max(1,[int]$cell.gridSpan) - 1)
                $endRow = [Math]::Min($rows.Count - 1, $row + [Math]::Max(1,[int]$cell.rowSpan) - 1)
                $cw = $sx * ($columns[$col..$endColumn] | Measure-Object -Sum).Sum
                $ch = $sy * ($rowHeights[$row..$endRow] | Measure-Object -Sum).Sum
                $properties = $cell.SelectSingleNode("./*[local-name()='tcPr']")
                $body = $cell.SelectSingleNode("./*[local-name()='txBody']")
                $fill = Read-Color $properties.solidFill
                if ($fill) {
                    $surface = New-Bounds $cx $cy $cw $ch $null
                    $surface.type = 'shape'
                    $surface.kind = 'rect'
                    $surface.label = 'Cell fill'
                    $surface.fill = $fill
                    $surface
                }
                if ($body) { Read-TextBox (New-Bounds $cx $cy $cw $ch $null) $body $properties }
            }
            $cx += $sx * $columns[$col]
        }
        $cy += $sy * $rowHeights[$row]
    }
}
function Read-Elements($tree, $relations, $offsetX, $offsetY, $scaleX, $scaleY) {
    foreach ($shape in $tree.ChildNodes) {
        $transform = $shape.SelectSingleNode("./*[local-name()='xfrm'] | ./*/*[local-name()='xfrm']")
        if (!$transform.off -or !$transform.ext) { continue }
        $x = $offsetX + $scaleX * [double]$transform.off.x
        $y = $offsetY + $scaleY * [double]$transform.off.y
        $w = $scaleX * [double]$transform.ext.cx
        $h = $scaleY * [double]$transform.ext.cy
        if ($shape.LocalName -eq 'grpSp') {
            if (![double]$transform.chExt.cx -or ![double]$transform.chExt.cy) { continue }
            $nextX = $w / [double]$transform.chExt.cx
            $nextY = $h / [double]$transform.chExt.cy
            Read-Elements $shape $relations ($x - $nextX * [double]$transform.chOff.x) ($y - $nextY * [double]$transform.chOff.y) $nextX $nextY
            continue
        }
        $layer = New-Bounds $x $y $w $h $transform
        if ($shape.LocalName -eq 'pic') {
            $picture = $shape.SelectSingleNode(".//*[local-name()='blip']")
            $video = $shape.SelectSingleNode(".//*[local-name()='videoFile']")
            $pictureId = $picture.GetAttribute('embed', $relNamespace)
            $videoId = if ($video) { $video.GetAttribute('link', $relNamespace) }
            $imageSrc = if ($pictureId) { Copy-Media $relations[$pictureId] }
            $vector = $shape.SelectSingleNode(".//*[local-name()='svgBlip']")
            if ($vector) {
                $vectorSource = Copy-Media $relations[$vector.GetAttribute('embed', $relNamespace)]
                if ($vectorSource) { $imageSrc = $vectorSource }
            }
            $videoSrc = if ($videoId) { Copy-Media $relations[$videoId] }
            $embeddedVideo = $shape.SelectSingleNode(".//*[local-name()='media']")
            if (!$videoSrc -and $embeddedVideo) {
                $mediaId = $embeddedVideo.GetAttribute('embed', $relNamespace)
                if ($mediaId) { $videoSrc = Copy-Media $relations[$mediaId] }
            }
            if (!$imageSrc -and !$videoSrc) { continue }
            $layer.type = if ($videoSrc) { 'video' } else { 'image' }
            $layer.src = if ($videoSrc) { $videoSrc } else { $imageSrc }
            $layer.label = [IO.Path]::GetFileName($layer.src)
            $layer.fit = 'fill'
            if ($videoSrc -and $imageSrc) { $layer.poster = $imageSrc }
            $crop = $shape.SelectSingleNode(".//*[local-name()='srcRect']")
            if ($crop -and ($crop.l -or $crop.t -or $crop.r -or $crop.b)) {
                $layer.crop = @{ left = [double]$crop.l / 100000; top = [double]$crop.t / 100000; right = [double]$crop.r / 100000; bottom = [double]$crop.b / 100000 }
            }
            $layer
        } elseif ($shape.LocalName -in 'sp','cxnSp') {
            Read-Decoration $shape $layer
            if ($shape.txBody) { Read-TextBox $layer $shape.txBody $null }
        } elseif ($shape.LocalName -eq 'graphicFrame') {
            $table = $shape.SelectSingleNode(".//*[local-name()='tbl']")
            if ($table) { Read-Table $table $x $y $w $h }
        }
    }
}

try {
    $relNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    $presentation = Read-Part 'ppt/presentation.xml'
    $size = $presentation.SelectSingleNode("//*[local-name()='sldSz']")
    $width = [double]$size.cx
    $height = [double]$size.cy
    $presentationRels = Relations 'ppt/presentation.xml'
    $orderedIds = @($presentation.SelectNodes("/*/*[local-name()='sldIdLst']/*[local-name()='sldId']"))
    $orderedParts = @($orderedIds | ForEach-Object { $presentationRels[$_.GetAttribute('id', $relNamespace)] })
    $slideSections = @{}
    $sections = @(foreach ($section in $presentation.SelectNodes("//*[local-name()='sectionLst']/*[local-name()='section']")) {
        $id = $section.GetAttribute('id')
        foreach ($member in $section.SelectNodes(".//*[local-name()='sldId']")) { $slideSections[$member.GetAttribute('id')] = $id }
        @{ id = $id; name = ($section.GetAttribute('name') -replace '_',' ') }
    })
    if ($All) { $Slides = 1..$orderedParts.Count }
    $thumbnailDirectory = Join-Path $OutputDirectory 'thumbnails'
    $result = foreach ($number in $Slides) {
        if ($number -lt 1 -or $number -gt $orderedParts.Count) { throw "Slide $number is outside the deck." }
        $part = $orderedParts[$number - 1]
        $document = Read-Part $part
        $tree = $document.SelectSingleNode("//*[local-name()='spTree']")
        $relations = Relations $part
        $palette = Read-Theme $relations
        $colorMap = $defaultColorMap.Clone()
        $overrideMap = $document.SelectSingleNode("//*[local-name()='clrMapOvr']/*[local-name()='overrideClrMapping']")
        if ($overrideMap) { foreach ($attribute in $overrideMap.Attributes) { $colorMap[$attribute.LocalName] = $attribute.Value } }
        $layers = @(Read-Elements $tree $relations 0 0 1 1)
        $textLayers = @($layers | Where-Object { $_.type -eq 'text' -and $_.label -eq 'Text' })
        $title = $textLayers | Sort-Object -Property @{Expression={ $_['size'] };Descending=$true}, { $_['y'] } | Select-Object -First 1
        if ($title) { $title.label = 'Title' }
        $background = Read-Color ($document.SelectSingleNode("//*[local-name()='bgPr']/*[local-name()='solidFill']"))
        $slide = [ordered]@{
            id = "source-$number"
            sourceNumber = $number
            sectionId = $slideSections[$orderedIds[$number - 1].GetAttribute('id')]
            name = if ($title) { ($title.text -split [char]10)[0] } else { "Slide $number" }
            template = 'custom'
            background = if ($background) { $background } else { '#ffffff' }
            font = ''
            transition = 'none'
            layers = $layers
        }
        $thumbnailFile = "slide-$number.jpg"
        if ($ThumbnailUrlPrefix -and (Test-Path -LiteralPath (Join-Path $thumbnailDirectory $thumbnailFile))) {
            $slide.thumbnail = "$($ThumbnailUrlPrefix.TrimEnd('/'))/$thumbnailFile"
        }
        $slide
    }
    $project = [ordered]@{ version = 1; name = $DeckName; font = 'Arial'; originalFonts = $true; aspect = $width / $height; sections = $sections; slides = @($result) }
    $json = ConvertTo-Json -InputObject $project -Depth 20
    [IO.File]::WriteAllText((Join-Path (Resolve-Path -LiteralPath $OutputDirectory) 'starter.json'), $json, [Text.UTF8Encoding]::new($false))
    Write-Output "Converted $($project.slides.Count) slides and extracted $($copied.Count) original media files."
    if ($unsupported.Count) { Write-Warning "Skipped unsupported media formats: $($unsupported -join ', ')" }
} finally { $archive.Dispose() }
