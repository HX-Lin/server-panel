package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"server-panel/serverpanel"
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "panel" {
		args = args[1:]
	} else if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		fatalUsage(fmt.Sprintf("unknown subcommand: %s", args[0]))
	}

	configDefault := getEnv("SERVER_PANEL_CONFIG", "")
	flags := flag.NewFlagSet("server-panel", flag.ExitOnError)
	flags.SetOutput(os.Stderr)

	configPath := configDefault
	flags.StringVar(&configPath, "config", configDefault, "Path to panel config.json [env: SERVER_PANEL_CONFIG]")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: %s [panel] [--config path]\n", os.Args[0])
		fmt.Fprintln(flags.Output(), "\nStart the lightweight lab server panel.")
		flags.PrintDefaults()
	}

	if err := flags.Parse(args); err != nil {
		log.Fatal(err)
	}
	if flags.NArg() > 0 {
		fatalUsage("unexpected arguments: " + strings.Join(flags.Args(), " "))
	}

	if err := serverpanel.Run(configPath); err != nil {
		log.Fatal(err)
	}
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func fatalUsage(message string) {
	fmt.Fprintln(os.Stderr, message)
	fmt.Fprintf(os.Stderr, "Usage: %s [panel] [--config path]\n", os.Args[0])
	os.Exit(2)
}
