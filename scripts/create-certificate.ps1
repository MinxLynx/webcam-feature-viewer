param([Parameter(Mandatory=$true)][string]$OutputDirectory, [Parameter(Mandatory=$true)][string]$Addresses)
$ErrorActionPreference = 'Stop'
# Generate keys in memory only. Nothing is installed in the Windows trust store.
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$caKey = [System.Security.Cryptography.RSA]::Create(2048)
$serverKey = [System.Security.Cryptography.RSA]::Create(2048)
$hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$name = 'Feature Lens Local ' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$name", $caKey, $hash, $padding)
$caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
$caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign,$true))
$caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($caRequest.PublicKey,$false))
$now = [DateTimeOffset]::UtcNow
$ca = $caRequest.CreateSelfSigned($now.AddMinutes(-5), $now.AddDays(366))
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Feature Lens Local Server', $serverKey, $hash, $padding)
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
$usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage,$true))
$oids = [System.Security.Cryptography.OidCollection]::new()
$null = $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
foreach ($address in ($Addresses -split ',')) { $san.AddIpAddress([System.Net.IPAddress]::Parse($address)) }
$request.CertificateExtensions.Add($san.Build())
$leaf = $request.Create($ca, $now.AddMinutes(-5), $now.AddDays(365), [Guid]::NewGuid().ToByteArray())
$withKey = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($leaf,$serverKey)
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'server.pfx'), $withKey.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'root.cer'), $ca.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'server.cer'), $leaf.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
$withKey.Dispose(); $leaf.Dispose(); $ca.Dispose(); $serverKey.Dispose(); $caKey.Dispose()
# The CA private key is deliberately discarded; it cannot issue other certificates.
Write-Output 'Local HTTPS certificate created. No system trust settings were changed.'
