# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.1.0] - 2025-12-31

Initial foundation release. Provides a complete Docker Compose template for deploying web applications with reverse proxy, databases, caching, and automated backups.

### Added
- Foundation architecture with Traefik v3 reverse proxy
- Docker socket proxy for secure Docker API access
- Supporting tech profiles: PostgreSQL (with pgvector), MySQL 8.0, MongoDB 6.0, Redis 7, MinIO
- Example applications: Ghost, LibreChat, Matrix Synapse, PeerTube, Solid, Landing page
- Secret management via file-based injection (never environment variables)
- Three-tier network isolation (proxy-external, app-internal, db-internal)
- Automated backup scripts with retention policies
- Health check configurations with database-specific anchors (120s start_period)
- Resource profiles: lite, core, full
- Deployment helper script (`scripts/deploy.sh`) for one-command deployment
- Volume initialization script (`scripts/init-volumes.sh`) for non-root container permissions
- Secret validation mode (`scripts/generate-secrets.sh --validate`)
- Multi-domain support pattern via compose override files
- Complete documentation suite:
  - Quick Start Guide
  - Configuration Reference
  - Profiles Guide
  - Security Guide
  - Deployment Guide
  - Deployment Lessons Learned
  - Backup and Restore Guide
  - Troubleshooting Guide

### Security
- Non-root container execution where supported
- Docker socket proxy isolates Docker API (read-only access)
- Secret files with strict permissions (600)
- Network segmentation prevents direct internet access to databases
- Automatic HTTPS via Let's Encrypt
- Security options: no-new-privileges, capability dropping

---

## Version Roadmap

### 0.1.0 - Minimum Viable Product
Basic composition that works for a single use case.

### 0.2.0 - Extended Examples
Additional example applications and improved backup/restore documentation.

### 0.3.0 - Production Hardening
Security hardening guide, full profile with monitoring, deployment documentation.

### 0.5.0 - Security Review
Internal security review completed, vulnerability scanning integrated.

### 1.0.0 - Production Ready
Meets all success criteria: 8-hour deployment, 30-day unattended operation, security audit passed.
