$ErrorActionPreference = 'Stop'

$target = Join-Path $PSScriptRoot '..\..\apps\web\public\templates\Template_Berita_Acara_Serah_Terima_BAST.docx'
$target = [System.IO.Path]::GetFullPath($target)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

function Add-Paragraph {
  param($Document, [string]$Text, [int]$Size = 10, [bool]$Bold = $false, [int]$Alignment = 0)
  $range = $Document.Content
  $range.Collapse(0)
  $range.Text = $Text
  $range.Font.Name = 'Arial'
  $range.Font.Size = $Size
  $range.Font.Bold = [int]$Bold
  $range.ParagraphFormat.Alignment = $Alignment
  $range.InsertParagraphAfter()
}

function Add-InfoTable {
  param($Document, [string]$Title, [string[][]]$Rows)
  $range = $Document.Content
  $range.Collapse(0)
  $table = $Document.Tables.Add($range, $Rows.Count + 1, 2)
  $table.Borders.Enable = 1
  $table.Range.Font.Name = 'Arial'
  $table.Range.Font.Size = 9
  $table.Cell(1, 1).Merge($table.Cell(1, 2))
  $table.Cell(1, 1).Range.Text = $Title
  $table.Cell(1, 1).Range.Bold = 1
  $table.Cell(1, 1).Shading.BackgroundPatternColor = 15132390
  for ($index = 0; $index -lt $Rows.Count; $index++) {
    $table.Cell($index + 2, 1).Range.Text = $Rows[$index][0]
    $table.Cell($index + 2, 1).Range.Bold = 1
    $table.Cell($index + 2, 2).Range.Text = $Rows[$index][1]
  }
  $Document.Content.InsertParagraphAfter()
}

try {
  $document = $word.Documents.Add()
  $document.PageSetup.TopMargin = 42
  $document.PageSetup.BottomMargin = 42
  $document.PageSetup.LeftMargin = 50
  $document.PageSetup.RightMargin = 50

  Add-Paragraph $document 'INTERNAL' 8 $true 1

  $range = $document.Content
  $range.Collapse(0)
  $header = $document.Tables.Add($range, 1, 3)
  $header.Borders.Enable = 1
  $header.Range.Font.Name = 'Arial'
  $header.Cell(1, 1).Range.Text = 'agit'
  $header.Cell(1, 1).Range.Font.Size = 24
  $header.Cell(1, 1).Range.Font.Bold = 1
  $header.Cell(1, 2).Range.Text = "BERITA ACARA SERAH TERIMA`nDOKUMEN / HASIL PEKERJAAN"
  $header.Cell(1, 2).Range.Font.Bold = 1
  $header.Cell(1, 2).Range.ParagraphFormat.Alignment = 1
  $header.Cell(1, 3).Range.Text = "Versi: [Versi]`nTanggal: [Tanggal]"
  $document.Content.InsertParagraphAfter()

  Add-Paragraph $document 'BERITA ACARA SERAH TERIMA' 15 $true 1
  Add-Paragraph $document 'Nomor: [Nomor BAST]' 10 $false 1
  Add-Paragraph $document 'Pada hari ini, [hari], tanggal [tanggal], bertempat di [lokasi], para pihak di bawah ini menerangkan bahwa:'

  Add-InfoTable $document 'PIHAK PERTAMA (PENYERAH)' @(
    @('Nama', '[Nama lengkap]'),
    @('Jabatan', '[Jabatan]'),
    @('Perusahaan / Unit', '[Perusahaan atau unit kerja]')
  )
  Add-InfoTable $document 'PIHAK KEDUA (PENERIMA)' @(
    @('Nama', '[Nama lengkap]'),
    @('Jabatan', '[Jabatan]'),
    @('Perusahaan / Unit', '[Perusahaan atau unit kerja]')
  )
  Add-InfoTable $document 'INFORMASI PROYEK' @(
    @('Nama Proyek', '[Nama proyek]'),
    @('Nama Sistem / Aplikasi', '[Nama sistem atau aplikasi]'),
    @('Nomor PO / Kontrak', '[Nomor PO atau kontrak, bila ada]'),
    @('Periode Pekerjaan', '[Tanggal mulai] s.d. [Tanggal selesai]')
  )

  Add-Paragraph $document 'PIHAK PERTAMA dengan ini menyerahkan kepada PIHAK KEDUA, dan PIHAK KEDUA menyatakan menerima, hasil pekerjaan berikut dalam kondisi baik dan sesuai ruang lingkup yang telah disepakati.'

  $range = $document.Content
  $range.Collapse(0)
  $deliverables = $document.Tables.Add($range, 5, 4)
  $deliverables.Borders.Enable = 1
  $deliverables.Range.Font.Name = 'Arial'
  $deliverables.Range.Font.Size = 9
  @('No.', 'Hasil Pekerjaan / Dokumen', 'Status', 'Keterangan') | ForEach-Object -Begin { $column = 1 } -Process {
    $deliverables.Cell(1, $column).Range.Text = $_
    $deliverables.Cell(1, $column).Range.Bold = 1
    $deliverables.Cell(1, $column).Shading.BackgroundPatternColor = 15132390
    $column++
  }
  for ($row = 2; $row -le 5; $row++) { $deliverables.Cell($row, 1).Range.Text = [string]($row - 1) }
  $deliverables.Cell(2, 2).Range.Text = '[Isi hasil pekerjaan]'
  $deliverables.Cell(2, 3).Range.Text = '[Diterima]'
  $document.Content.InsertParagraphAfter()

  Add-InfoTable $document 'CATATAN / TINDAK LANJUT' @(
    @('Catatan', '[Tuliskan catatan, pengecualian, atau tindak lanjut bila ada]')
  )
  Add-Paragraph $document 'Demikian Berita Acara Serah Terima ini dibuat dengan sebenar-benarnya untuk dipergunakan sebagaimana mestinya.'

  $range = $document.Content
  $range.Collapse(0)
  $signatures = $document.Tables.Add($range, 2, 2)
  $signatures.Borders.Enable = 1
  $signatures.Range.Font.Name = 'Arial'
  $signatures.Range.Font.Size = 9
  $signatures.Cell(1, 1).Range.Text = "PIHAK PERTAMA`nYang Menyerahkan"
  $signatures.Cell(1, 2).Range.Text = "PIHAK KEDUA`nYang Menerima"
  $signatures.Rows.Item(1).Range.Bold = 1
  $signatures.Rows.Item(1).Range.ParagraphFormat.Alignment = 1
  $signatures.Cell(2, 1).Range.Text = "`n`n`nTanda tangan dan stempel`n`n( [Nama] )`n[Jabatan]"
  $signatures.Cell(2, 2).Range.Text = "`n`n`nTanda tangan dan stempel`n`n( [Nama] )`n[Jabatan]"
  $signatures.Rows.Item(2).Range.ParagraphFormat.Alignment = 1

  $document.SaveAs2($target, 16)
  $document.Close($false)
} finally {
  $word.Quit()
}

Get-Item $target | Select-Object FullName, Length
