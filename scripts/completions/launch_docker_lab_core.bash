# ==============================================================
# Bash completion for launch_peermesh.sh
# ==============================================================
# Installation:
#   # Option 1: Source directly in your .bashrc
#   source /path/to/scripts/completions/launch_peermesh.bash
#
#   # Option 2: Copy to bash-completion directory
#   sudo cp scripts/completions/launch_peermesh.bash /etc/bash_completion.d/launch_peermesh
#
#   # Option 3: macOS with Homebrew
#   cp scripts/completions/launch_peermesh.bash $(brew --prefix)/etc/bash_completion.d/
# ==============================================================

_launch_peermesh_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="status up down deploy sync logs health backup module config help version"
    local up_opts="--profile --profiles -p --build --wait --no-detach -f"
    local down_opts="-v --volumes --timeout --keep-orphans"
    local deploy_opts="--target -t --skip-backup --profile --profiles"
    local sync_opts="--target -t --url --secret"
    local logs_opts="-f --follow -n --tail -t --timestamps"
    local health_opts="-v --verbose"
    local backup_actions="run status list restore"
    local backup_opts="--target postgres volumes all"
    local module_actions="list ls enable install disable uninstall status"
    local config_actions="show view init validate edit"
    local global_opts="-h --help -V --version --debug"

    # Available profiles (detected from docker-compose.yml)
    local profiles="postgresql mysql mongodb redis minio monitoring backup dev webhook identity"

    # Available modules (would be detected from modules/ directory)
    local modules="backup pki test-module"

    # Handle different completion contexts
    case "${prev}" in
        launch_peermesh.sh|./launch_peermesh.sh)
            COMPREPLY=($(compgen -W "${commands} ${global_opts}" -- "${cur}"))
            return 0
            ;;

        # Profile options
        --profile|--profiles|-p)
            COMPREPLY=($(compgen -W "${profiles}" -- "${cur}"))
            return 0
            ;;

        --profile=*|--profiles=*)
            # Handle comma-separated profiles
            local prefix="${cur%,*},"
            if [[ "${cur}" == *,* ]]; then
                COMPREPLY=($(compgen -W "${profiles}" -- "${cur##*,}"))
                COMPREPLY=("${COMPREPLY[@]/#/${prefix}}")
            else
                COMPREPLY=($(compgen -W "${profiles}" -- "${cur}"))
            fi
            return 0
            ;;

        # Target options
        --target|-t)
            COMPREPLY=($(compgen -W "local staging production prod" -- "${cur}"))
            return 0
            ;;

        # Tail/lines options
        -n|--tail)
            COMPREPLY=($(compgen -W "10 50 100 500 1000" -- "${cur}"))
            return 0
            ;;

        # Timeout option
        --timeout)
            COMPREPLY=($(compgen -W "5 10 30 60 120" -- "${cur}"))
            return 0
            ;;

        # Compose file option
        -f)
            COMPREPLY=($(compgen -f -X '!*.yml' -- "${cur}"))
            return 0
            ;;

        # Backup targets
        backup)
            COMPREPLY=($(compgen -W "${backup_actions} ${backup_opts}" -- "${cur}"))
            return 0
            ;;

        # Module actions
        module|mod)
            COMPREPLY=($(compgen -W "${module_actions}" -- "${cur}"))
            return 0
            ;;

        # Module names for enable/disable/status
        enable|install|disable|uninstall)
            COMPREPLY=($(compgen -W "${modules}" -- "${cur}"))
            return 0
            ;;

        # Config actions
        config|cfg)
            COMPREPLY=($(compgen -W "${config_actions}" -- "${cur}"))
            return 0
            ;;

        # Edit action - complete with files
        edit)
            COMPREPLY=($(compgen -f -- "${cur}"))
            return 0
            ;;
    esac

    # Handle command-specific options
    local cmd=""
    for word in "${words[@]}"; do
        case "${word}" in
            status|up|down|deploy|sync|logs|health|backup|module|config)
                cmd="${word}"
                break
                ;;
        esac
    done

    case "${cmd}" in
        up)
            COMPREPLY=($(compgen -W "${up_opts}" -- "${cur}"))
            ;;
        down)
            COMPREPLY=($(compgen -W "${down_opts}" -- "${cur}"))
            ;;
        deploy)
            COMPREPLY=($(compgen -W "${deploy_opts}" -- "${cur}"))
            ;;
        sync)
            COMPREPLY=($(compgen -W "${sync_opts}" -- "${cur}"))
            ;;
        logs)
            # Complete with service names or options
            local services=$(docker compose ps --format '{{.Service}}' 2>/dev/null || echo "traefik dashboard postgres redis")
            COMPREPLY=($(compgen -W "${logs_opts} ${services}" -- "${cur}"))
            ;;
        health)
            COMPREPLY=($(compgen -W "${health_opts}" -- "${cur}"))
            ;;
        backup)
            COMPREPLY=($(compgen -W "${backup_actions} ${backup_opts}" -- "${cur}"))
            ;;
        module)
            COMPREPLY=($(compgen -W "${module_actions}" -- "${cur}"))
            ;;
        config)
            COMPREPLY=($(compgen -W "${config_actions}" -- "${cur}"))
            ;;
        *)
            # Default to commands and global options
            if [[ "${cur}" == -* ]]; then
                COMPREPLY=($(compgen -W "${global_opts}" -- "${cur}"))
            else
                COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
            fi
            ;;
    esac

    return 0
}

# Register completion for both script names
complete -F _launch_peermesh_completions launch_peermesh.sh
complete -F _launch_peermesh_completions ./launch_peermesh.sh

# Also register for common aliases
complete -F _launch_peermesh_completions pmdl
complete -F _launch_peermesh_completions peermesh
