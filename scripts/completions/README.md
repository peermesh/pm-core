# Shell Completions for launch_docker_lab_core.sh

This directory contains shell completion scripts for the PeerMeshCore CLI.

## Bash

### Installation Options

**Option 1: Source directly in .bashrc**
```bash
# Add to ~/.bashrc
source /path/to/peer-mesh-docker-lab/scripts/completions/launch_docker_lab_core.bash
```

**Option 2: System-wide installation**
```bash
sudo cp scripts/completions/launch_docker_lab_core.bash /etc/bash_completion.d/launch_docker_lab_core
```

**Option 3: macOS with Homebrew**
```bash
cp scripts/completions/launch_docker_lab_core.bash $(brew --prefix)/etc/bash_completion.d/
```

### Reload
```bash
source ~/.bashrc
# or
exec bash
```

## Zsh

### Installation Options

**Option 1: Add to fpath in .zshrc**
```zsh
# Add to ~/.zshrc BEFORE compinit
fpath=(/path/to/peer-mesh-docker-lab/scripts/completions $fpath)
autoload -Uz compinit && compinit
```

**Option 2: System-wide installation**
```zsh
sudo cp scripts/completions/launch_docker_lab_core.zsh /usr/local/share/zsh/site-functions/_launch_docker_lab_core
```

**Option 3: macOS with Homebrew**
```zsh
cp scripts/completions/launch_docker_lab_core.zsh $(brew --prefix)/share/zsh/site-functions/_launch_docker_lab_core
```

### Reload
```zsh
autoload -U compinit && compinit
# or
exec zsh
```

## Features

The completions provide:

- Command completion (status, up, down, deploy, etc.)
- Option completion for each command
- Profile names (postgresql, redis, backup, etc.)
- Target names (local, staging, production)
- Module names (backup, pki, test-module)
- Service names for logs command
- File completion for config edit

## Aliases

The completions also work with common aliases:
- `pmdl`
- `peermesh`

To set up aliases, add to your shell config:

```bash
# .bashrc or .zshrc
alias pmdl='./launch_docker_lab_core.sh'
alias peermesh='./launch_docker_lab_core.sh'
```

## Troubleshooting

**Completions not working:**
1. Check if completions are loaded: `complete -p launch_docker_lab_core.sh` (bash) or `_launch_docker_lab_core` (zsh)
2. Ensure script is sourced after bash-completion is loaded
3. For zsh, ensure compinit is called after adding to fpath

**Dynamic completions (service names) not working:**
- Ensure Docker is running
- Ensure you're in the project directory
