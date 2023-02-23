const { spawn, ChildProcess } = require("child_process")
const express = require("express")
const aws = require('aws-sdk')
const CwLogger = require("./cw-logger.js")

const cw = new aws.CloudWatch()
const cwl = new aws.CloudWatchLogs()
const stepfunctions = new aws.StepFunctions()
const minecraftServerLogger = new CwLogger(cwl, "MinecraftServer", null)
const minecraftServerDaemonLogger = new CwLogger(cwl, "MinecraftServerDaemon", null)
const minecraftServerEventsLogger = new CwLogger(cwl, "MinecraftServerEvents", "Events")
const port = 80
const app = express()
app.use(express.json())
const lastPlayerAt = Date.now()

var minecraftServerProcessStatus = "Starting"

minecraftServerDaemonLogger.log("Minecraft server daemon has started")

const spawnMinecraftServerProcess = () => {
	
	minecraftServerDaemonLogger.log("Spawning the minecraft server child process.")

	const childProcess = spawn(
		"java",
		["-jar", "-Xmx7000M", "-Xms2048M", "/home/ec2-user/ftb-ultimate-reloaded-server/forge-1.12.2-14.23.5.2846-universal.jar"],
		{"cwd": "/home/ec2-user/ftb-ultimate-reloaded-server/"}
	)

	childProcess.stdout.on("data", data => {
		const listCommandMatch = data.toString().match(/There are ([0-9]+)\/([0-9]+) players online/)
		if (listCommandMatch != null) {
			if (parseInt(listCommandMatch[1]) > 0) {
				lastPlayerAt = Date.now()
			}
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
		if (!["ShuttingDown", "Shutdown"].includes(minecraftServerProcessStatus)) {
			minecraftServerProcessStatus = "Starting"
			minecraftServerProcess = spawnMinecraftServerProcess()
			minecraftServerEventsLogger.log("The minecraft server process exited unexpectedly and was restarted by the daemon on the instance.")
		} else {
			minecraftServerProcessStatus = "Shutdown"
		}
	})

	return childProcess
}

var minecraftServerProcess = spawnMinecraftServerProcess()

const exitEvents = ["exit", "SIGINT", "SIGUSR1", "SIGUSR2", "uncaughtException", "SIGTERM"]
exitEvents.forEach((eventType) => {
	process.on(eventType, () => exitHandler(() => null))
})

const exitHandler = () => {
	if (!["ShuttingDown", "Shutdown"].includes(minecraftServerProcessStatus)) {
		minecraftServerProcessStatus = "ShuttingDown"
		const exitTimeoutSeconds = 10
		setTimeout(() => {
			console.log("Not able to exit properly before timeout")
			process.exit(1)
		}, exitTimeoutSeconds * 1000)
		minecraftServerDaemonLogger.log(`The daemon is exiting with an exit timeout of ${exitTimeoutSeconds} seconds.`)
		minecraftServerDaemonLogger.log("Killing the minecraft server process and sending final logs to CloudWatch.")
		if (minecraftServerProcess.exitCode == null) {
			minecraftServerProcess.kill()
		}
		minecraftServerLogger.sendBatchToCw()
		minecraftServerDaemonLogger.sendBatchToCw()
		setInterval(() => {
			if (minecraftServerProcess.exitCode != null && minecraftServerLogger.getBatchSize() == 0 && minecraftServerLogger.getBatchSize() == 0) {
				console.log("Successfully killed the minecraft server process and sent final logs to CloudWatch")
				process.exit(0)
			} else {
				console.log(`Still not ready to exit. exitCode: ${minecraftServerProcess.exitCode}, logger batch sizes: ${minecraftServerLogger.getBatchSize(), minecraftServerLogger.getBatchSize()}`)
			}
		}, 1000)
	}
}

const playerCountCheckInterval = setInterval(() => {
	if (Date.now() - lastPlayerAt > 25 * 60 * 1000 && !["Shutdown", "ShuttingDown"].includes(minecraftServerProcessStatus)) {
		minecraftServerDaemonLogger.log("Shutting down due to inactivity.")
		stepfunctions.startExecution({
			stateMachineArn: "arn:aws:states:us-east-1:634329214694:stateMachine:DeprovisionMinecraftServer"
		}, function(err, data) {
			if (err) minecraftServerDaemonLogger.log("Unable to start execution: " + err)
		})
	}
	if (minecraftServerProcess.exitCode == null) {
		minecraftServerProcess.stdin.write("list\n")
	}
}, 60 * 1000)

const cwLoggerInterval = setInterval(() => {
	minecraftServerLogger.sendBatchToCw()
	minecraftServerDaemonLogger.sendBatchToCw()
	minecraftServerEventsLogger.sendBatchToCw()
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
			if (minecraftServerProcessStatus !== "Available") {
				minecraftServerProcessStatus = "Available"
			}
		}
	})
}

app.post("/shutdownMinecraftServer", (req, res) => {
	try {
		minecraftServerDaemonLogger.log("Recieved a '/shutdownMinecraftServer' HTTP request.")
		if (minecraftServerProcessStatus !== "Shutdown") {
			minecraftServerProcessStatus = "ShuttingDown"
		}
		if (minecraftServerProcess.exitCode == null) {
			minecraftServerProcess.kill()
		}
		res.status(200)
		res.send(null)
	} catch (error) {
		res.status(500)
		res.send(null)
	}
})

app.get("/minecraftServerProcessStatus", (req, res) => {
	minecraftServerDaemonLogger.log("Recieved a '/minecraftServerProcessStatus' HTTP request.")
	res.status(200)
	res.set("Content-Type", "application/json");
	res.send({
		status: minecraftServerProcessStatus
	})
})

app.listen(port, () => console.log(`Listening on port ${port}...`))

