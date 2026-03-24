#compdef launch_peermesh.sh pmdl peermesh

# ==============================================================
# Zsh completion for launch_peermesh.sh
# ==============================================================
# Installation:
#   # Option 1: Add to your fpath in .zshrc (before compinit)
#   fpath=(/path/to/scripts/completions $fpath)
#   autoload -Uz compinit && compinit
#
#   # Option 2: Copy to zsh site-functions
#   sudo cp scripts/completions/launch_peermesh.zsh /usr/local/share/zsh/site-functions/_launch_peermesh
#
#   # Option 3: macOS with Homebrew
#   cp scripts/completions/launch_peermesh.zsh $(brew --prefix)/share/zsh/site-functions/_launch_peermesh
#
#   # Reload completions
#   autoload -U compinit && compinit
# ==============================================================

_launch_peermesh() {
    local -a commands
    local -a global_opts
    local -a profiles
    local -a targets
    local -a modules

    commands=(
        'status:Show current deployment status'
        'up:Start services'
        'down:Stop services'
        'deploy:Deploy to target'
        'sync:Trigger sync on remote target'
        'logs:View service logs'
        'health:Run health checks'
        'backup:Run backup operations'
        'module:Module management'
        'config:Configuration management'
        'help:Show detailed help'
        'version:Show version'
    )

    global_opts=(
        '-h[Show help]'
        '--help[Show detailed help]'
        '-V[Show version]'
        '--version[Show version]'
        '--debug[Enable debug output]'
    )

    profiles=(
        'postgresql:PostgreSQL 16 with pgvector'
        'mysql:MySQL 8.0'
        'mongodb:MongoDB 6.0'
        'redis:Redis 7 / Valkey'
        'minio:S3-compatible object storage'
        'monitoring:Prometheus, Grafana, Loki'
        'backup:Automated backup container'
        'dev:Adminer, Mailhog, debug tools'
        'webhook:Webhook auto-deploy service'
        'identity:Identity management'
    )

    targets=(
        'local:Local development environment'
        'staging:Staging/testing environment'
        'production:Production environment'
        'prod:Production environment (alias)'
    )

    modules=(
        'backup:Automated backup module'
        'pki:PKI certificate management'
        'test-module:Test module template'
    )

    _arguments -C \
        '1: :->command' \
        '*:: :->args' \
        && return 0

    case $state in
        command)
            _describe -t commands 'command' commands
            _describe -t global_opts 'global option' global_opts
            ;;

        args)
            case $words[1] in
                up|start)
                    _arguments \
                        '--profile=[Enable profiles]:profile:_values -s , profile ${profiles%%:*}' \
                        '--profiles=[Enable profiles]:profile:_values -s , profile ${profiles%%:*}' \
                        '-p[Enable profile]:profile:_values profile ${profiles%%:*}' \
                        '--build[Build images before starting]' \
                        '--wait[Wait for services to be healthy]' \
                        '--no-detach[Run in foreground]' \
                        '-f[Include compose file]:file:_files -g "*.yml"'
                    ;;

                down|stop)
                    _arguments \
                        '-v[Remove volumes]' \
                        '--volumes[Remove volumes]' \
                        '--timeout=[Timeout in seconds]:seconds:(5 10 30 60 120)' \
                        '--keep-orphans[Keep orphan containers]'
                    ;;

                deploy)
                    _arguments \
                        '--target=[Deployment target]:target:_values target ${targets%%:*}' \
                        '-t[Deployment target]:target:_values target ${targets%%:*}' \
                        '--skip-backup[Skip pre-deployment backup]' \
                        '--profile=[Enable profiles]:profile:_values -s , profile ${profiles%%:*}'
                    ;;

                sync)
                    _arguments \
                        '--target=[Target name]:target:_values target ${targets%%:*}' \
                        '-t[Target name]:target:_values target ${targets%%:*}' \
                        '--url=[Webhook URL]:url:' \
                        '--secret=[Webhook secret]:secret:'
                    ;;

                logs)
                    local -a services
                    services=(${(f)"$(docker compose ps --format '{{.Service}}' 2>/dev/null)"})
                    [[ -z "$services" ]] && services=(traefik dashboard postgres redis)

                    _arguments \
                        '-f[Follow log output]' \
                        '--follow[Follow log output]' \
                        '-n[Number of lines]:lines:(10 50 100 500 1000)' \
                        '--tail[Number of lines]:lines:(10 50 100 500 1000)' \
                        '-t[Show timestamps]' \
                        '--timestamps[Show timestamps]' \
                        '1:service:_values service $services'
                    ;;

                health)
                    _arguments \
                        '-v[Show detailed endpoint checks]' \
                        '--verbose[Show detailed endpoint checks]'
                    ;;

                backup)
                    local -a backup_actions
                    backup_actions=(
                        'run:Run backup now'
                        'status:Show backup status'
                        'list:List available backups'
                        'restore:Restore from backup'
                    )

                    _arguments \
                        '1:action:_values action ${backup_actions%%:*}' \
                        '--target=[Backup target]:target:(postgres volumes all)' \
                        '*:target:(postgres volumes all)'
                    ;;

                module|mod)
                    local -a module_actions
                    module_actions=(
                        'list:List available modules'
                        'ls:List available modules'
                        'enable:Enable a module'
                        'install:Enable a module'
                        'disable:Disable a module'
                        'uninstall:Disable a module'
                        'status:Show module status'
                    )

                    case $words[2] in
                        enable|install|disable|uninstall|status)
                            _arguments '1:module:_values module ${modules%%:*}'
                            ;;
                        *)
                            _arguments '1:action:_values action ${module_actions%%:*}'
                            ;;
                    esac
                    ;;

                config|cfg)
                    local -a config_actions
                    config_actions=(
                        'show:Show current configuration'
                        'view:Show current configuration'
                        'init:Initialize configuration files'
                        'validate:Validate configuration'
                        'edit:Edit configuration file'
                    )

                    case $words[2] in
                        edit)
                            _arguments '1:file:_files'
                            ;;
                        *)
                            _arguments '1:action:_values action ${config_actions%%:*}'
                            ;;
                    esac
                    ;;

                help|version)
                    # No additional arguments
                    ;;

                *)
                    _describe -t commands 'command' commands
                    ;;
            esac
            ;;
    esac
}

# Register the completion function
_launch_peermesh "$@"
