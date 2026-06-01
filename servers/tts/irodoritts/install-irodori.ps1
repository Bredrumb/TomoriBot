# Patches and installs the IrodoriTTS package from source.
#
# A plain `pip install git+...` fails for two reasons:
#   1. Upstream packaging bugs in pyproject.toml:
#      a. license = "MIT" — must be license = {text = "MIT"} per PEP 621
#      b. configs/ dir at root — setuptools auto-discovery rejects the flat layout
#   2. dacvae (a dependency) is not on PyPI; upstream declares it via [tool.uv.sources]
#      which pip ignores, so it must be pre-installed from GitHub manually.
#
# Commits are pinned for supply-chain safety. To update, replace the SHA constants
# below with the new HEAD SHAs from each repo.
#
# Run with the venv activated from the irodoritts folder.

# Pinned commits — update these when pulling in upstream changes
$IRODORI_COMMIT = "2708d3cadf726d4389d25eb4bb7a0344517a9a40"  # Aratako/Irodori-TTS
$DACVAE_COMMIT  = "414c20785fc3a28373073ea8ef7a1316eeeaca6e"  # facebookresearch/dacvae

$clone_dir = "$env:TEMP\Irodori-TTS-patched"

Write-Host "Cloning Irodori-TTS @ $IRODORI_COMMIT..."
if (Test-Path $clone_dir) { Remove-Item -Recurse -Force $clone_dir }
git clone --quiet https://github.com/Aratako/Irodori-TTS.git $clone_dir
if ($LASTEXITCODE -ne 0) {
    Write-Error "git clone failed."
    exit 1
}
git -C $clone_dir checkout --quiet $IRODORI_COMMIT

if ($LASTEXITCODE -ne 0) {
    Write-Error "git checkout failed."
    exit 1
}

Write-Host "Patching pyproject.toml..."
$path = "$clone_dir\pyproject.toml"
$toml = Get-Content $path -Raw

# Fix 1: license bare string → table
$toml = $toml -replace 'license\s*=\s*"MIT"', 'license = {text = "MIT"}'

# Fix 2: restrict package discovery to irodori_tts, excluding configs/
if ($toml -notmatch '\[tool\.setuptools') {
    $toml += "`n[tool.setuptools.packages.find]`ninclude = [""irodori_tts*""]`n"
}

Set-Content $path $toml -NoNewline

Write-Host "Installing dacvae @ $DACVAE_COMMIT (not on PyPI — sourced from GitHub per upstream pyproject.toml)..."
pip install "git+https://github.com/facebookresearch/dacvae@$DACVAE_COMMIT"

if ($LASTEXITCODE -ne 0) {
    Write-Error "dacvae install failed."
    exit 1
}

Write-Host "Installing irodori-tts..."
pip install $clone_dir

if ($LASTEXITCODE -eq 0) {
    Write-Host "irodori-tts installed successfully."
} else {
    Write-Error "pip install failed."
    exit 1
}
