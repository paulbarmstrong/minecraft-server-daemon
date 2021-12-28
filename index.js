const { spawn, ChildProcess } = require("child_process")
const aws = require('aws-sdk')
const cw = new aws.CloudWatch({apiVersion: "2010-08-01", region: "us-east-2"})
const cwl = new aws.CloudWatchLogs({apiVersion: "2014-03-28", region: "us-east-2"})
const CwLogger = require("./cw-logger.js")
const { syncBuiltinESMExports } = require("module")
const minecraftServerLogger = new CwLogger(cwl, "MinecraftServer", true)
const minecraftServerDaemonLogger = new CwLogger(cwl, "MinecraftServerDaemon", true)

var exiting = false

minecraftServerDaemonLogger.log("Minecraft server daemon has started")

const spawnMinecraftServerProcess = () => {
	
	minecraftServerDaemonLogger.log("Spawning the minecraft server child process")

	const childProcess = spawn(
		"java",
		["-jar", "-Xmx3500M", "-Xms1024M", "/home/ec2-user/minecraft-server/forge-1.12.2-14.23.5.2846-universal.jar"],
		{"cwd": "/home/ec2-user/minecraft-server/"}
	)

	childProcess.stdout.on("data", data => {
		const listCommandMatch = data.toString().match(/There are ([0-9]+)\/([0-9]+) players online/)
		if (listCommandMatch != null) {
			postPlayerCountCwMetric(parseInt(listCommandMatch[1]))
		}
		data.toString().split("\n").filter(str => str.length > 0).forEach(line => minecraftServerLogger.log(line))
	})
	
	childProcess.stderr.on("data", data => {
		data.toString().split("\n").filter(str => str.length > 0).forEach(line => minecraftServerLogger.log(line))
	})
	
	childProcess.on('error', (error) => {
		minecraftServerDaemonLogger.log(`Unable to spawn the minecraft server process: ${error.message}`)
	})
	
	childProcess.on("close", code => {
		minecraftServerDaemonLogger.log(`Minecraft server process exited with exit code ${code}.`)
		if (!exiting) {
			minecraftServerProcess = spawnMinecraftServerProcess()
		}
	})
	return childProcess
}

var minecraftServerProcess = spawnMinecraftServerProcess()

const exitEvents = ["exit", "SIGINT", "SIGUSR1", "SIGUSR2", "uncaughtException", "SIGTERM"]
exitEvents.forEach((eventType) => {
	process.on(eventType, () => {
		if (!exiting) {
			exiting = true
			const exitTimeoutSeconds = 20
			setTimeout(() => process.exit(1), exitTimeoutSeconds * 1000)
			minecraftServerDaemonLogger.log(`The daemon is exiting with an exit timeout of ${exitTimeoutSeconds} seconds.`)
			minecraftServerDaemonLogger.log("Killing the minecraft server process and sending final logs to CloudWatch.")
			if (minecraftServerProcess.exitCode == null) {
				minecraftServerProcess.kill()
			}
			minecraftServerLogger.sendBatchToCw()
			minecraftServerDaemonLogger.sendBatchToCw()
			setInterval(() => {
				if (minecraftServerProcess.exitCode != null && minecraftServerLogger.getBatchSize() == 0 && minecraftServerLogger.getBatchSize() == 0) {
					process.exit(0)
				}
			}, 100)
		}
	})
})

const playerCountCheckInterval = setInterval(() => {
	if (minecraftServerProcess.exitCode == null) {
		minecraftServerProcess.stdin.write("list\n")
	}
}, 60 * 1000)

const cwLoggerInterval = setInterval(() => {
	minecraftServerLogger.sendBatchToCw()
	minecraftServerDaemonLogger.sendBatchToCw()
}, 1000)

const postPlayerCountCwMetric = (numPlayers) => {
	cw.putMetricData({
		MetricData: [
			{
			MetricName: "PlayerCount",
			Dimensions: [],
			Unit: "None",
			Value: parseInt(numPlayers)
			},
		],
		Namespace: "MinecraftServer"
	}, (err, data) => {
		if (err) {
			console.error("Unable to post PlayerCount CloudWatch metric: " + err)
		} else {
			minecraftServerDaemonLogger.log("Posted PlayerCount CloudWatch metric: " + JSON.stringify(data))
		}
	})
}
