package serverpanel

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"time"
)

type CommandResult struct {
	OK         bool
	Stdout     string
	Stderr     string
	ReturnCode int
	LatencyMS  int64
}

type SSHRunner struct {
	config *AppConfig
}

func NewSSHRunner(config *AppConfig) *SSHRunner {
	return &SSHRunner{config: config}
}

func (r *SSHRunner) RunScript(target KeyTarget, script string) CommandResult {
	command, err := r.commandFor(target.Mode, target.Host, target.User, target.Port)
	if err != nil {
		return CommandResult{
			OK:         false,
			Stderr:     err.Error(),
			ReturnCode: -1,
		}
	}
	return r.run(command, script)
}

func (r *SSHRunner) RunKeyScript(target KeyTarget, script string) CommandResult {
	return r.RunScript(target, script)
}

func (r *SSHRunner) commandFor(mode, host, user string, port int) ([]string, error) {
	if mode == "local" {
		return []string{"/bin/sh", "-s"}, nil
	}

	if host == "" {
		return nil, &ConfigError{Message: "ssh target host is required"}
	}

	destination := host
	if user != "" {
		destination = user + "@" + host
	}

	command := []string{
		"ssh",
		"-p",
		itoa(defaultInt(port, true, 22)),
		"-o",
		"BatchMode=yes",
		"-o",
		"ConnectTimeout=" + itoa(r.config.SSH.ConnectTimeoutSeconds),
		"-o",
		"StrictHostKeyChecking=" + r.config.SSH.KnownHostsMode,
	}
	if r.config.SSH.IdentityFile != "" {
		command = append(command, "-i", r.config.SSH.IdentityFile)
	}
	command = append(command, r.config.SSH.ExtraOptions...)
	command = append(command, destination, "sh", "-s")
	return command, nil
}

func (r *SSHRunner) run(command []string, stdin string) CommandResult {
	timeout := time.Duration(r.config.SSH.ConnectTimeoutSeconds+8) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Stdin = bytes.NewBufferString(stdin)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	latency := time.Since(start).Milliseconds()

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return CommandResult{
			OK:         false,
			Stdout:     stdout.String(),
			Stderr:     "command timed out",
			ReturnCode: 124,
			LatencyMS:  latency,
		}
	}

	if err != nil {
		returnCode := -1
		if exitErr, ok := err.(*exec.ExitError); ok {
			returnCode = exitErr.ExitCode()
		} else if cmd.ProcessState != nil {
			returnCode = cmd.ProcessState.ExitCode()
		}
		return CommandResult{
			OK:         false,
			Stdout:     stdout.String(),
			Stderr:     stderr.String(),
			ReturnCode: returnCode,
			LatencyMS:  latency,
		}
	}

	return CommandResult{
		OK:         true,
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ReturnCode: 0,
		LatencyMS:  latency,
	}
}
