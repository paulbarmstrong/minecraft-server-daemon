const { spawn } = require("child_process")
const aws = require('aws-sdk')
const cw = new aws.CloudWatch({apiVersion: '2010-08-01', region: "us-east-2"})

const minecraftServerProcess = spawn(
	"java",
	["-jar", "-Xmx3500M", "-Xms1024M", "/home/ec2-user/minecraft-server/forge-1.12.2-14.23.5.2846-universal.jar"],
	{"cwd": "/home/ec2-user/minecraft-server/"}
)

process.on('SIGINT', () => {
	console.log('Recieved SIGINT. Killing the minecraft server process')
	minecraftServerProcess.kill()
	console.log('Minecraft server process killed. Exiting')
	process.exit(0)
})

minecraftServerProcess.stdout.on("data", data => {
	const listCommandMatch = data.toString().match(/There are ([0-9]+)\/([0-9]+) players online/)
	if (listCommandMatch != null) {
		cw.putMetricData({
			MetricData: [
				{
				MetricName: "PlayerCount",
				Dimensions: [],
				Unit: "None",
				Value: parseInt(listCommandMatch[1])
				},
			],
			Namespace: "MinecraftServer"
		}, (err, data) => {
			if (err) {
				console.error("Unable to post PlayerCount CloudWatch metric: " + err)
			} else {
				console.log("Posted PlayerCount CloudWatch metric: " + JSON.stringify(data))
			}
		})
	}
    console.log(`Minecraft server stdout: ${data}`);
});

minecraftServerProcess.stderr.on("data", data => {
	console.log(`Minecraft server stderr: ${data}`);
})

minecraftServerProcess.on('error', (error) => {
    console.log(`Unable to spawn the minecraft server process: ${error.message}`);
});

minecraftServerProcess.on("close", code => {
    console.log(`Minecraft server process exited with exit code ${code}`);
});

const interval = setInterval(() => minecraftServerProcess.stdin.write("list\n"), 60 * 1000)
