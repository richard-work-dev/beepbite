param(
    [ValidateSet('api', 'realtime', 'stream', 'worker')]
    [string[]]$Functions = @('api', 'realtime', 'stream', 'worker')
)

$ErrorActionPreference = 'Stop'

$backend = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\backend')
$artifacts = Join-Path $PSScriptRoot '..\artifacts'
$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgo = $env:CGO_ENABLED
$oldGocache = $env:GOCACHE
$goCommand = Get-Command go -ErrorAction SilentlyContinue
$goExe = if ($goCommand) { $goCommand.Source } else { 'C:\Program Files\Go\bin\go.exe' }
$zipTool = Join-Path $artifacts 'build-lambda-zip.exe'

if (-not (Test-Path $goExe)) {
    throw 'Go was not found. Install Go 1.25 or newer before building the Lambdas.'
}

try {
    New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    $env:GOCACHE = Join-Path $backend 'tmp\go-build'
    Push-Location $backend
    & $goExe build -trimpath -o $zipTool 'github.com/aws/aws-lambda-go/cmd/build-lambda-zip'
    if ($LASTEXITCODE -ne 0) { throw 'failed to build build-lambda-zip' }

    $env:GOOS = 'linux'
    $env:GOARCH = 'arm64'
    $env:CGO_ENABLED = '0'

    foreach ($name in $Functions) {
        $staging = Join-Path $artifacts $name
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path $staging
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        & $goExe build -tags lambda.norpc -trimpath -ldflags '-s -w' -o (Join-Path $staging 'bootstrap') "./cmd/serverless/$name"
        if ($LASTEXITCODE -ne 0) { throw "go build failed for $name" }
        & $zipTool -o (Join-Path $artifacts "$name.zip") (Join-Path $staging 'bootstrap')
        if ($LASTEXITCODE -ne 0) { throw "Lambda archive failed for $name" }
        Remove-Item -Recurse -Force -Path $staging
    }
}
finally {
    Pop-Location
    Remove-Item -Force -ErrorAction SilentlyContinue -Path $zipTool
    $env:GOOS = $oldGoos
    $env:GOARCH = $oldGoarch
    $env:CGO_ENABLED = $oldCgo
    $env:GOCACHE = $oldGocache
}
