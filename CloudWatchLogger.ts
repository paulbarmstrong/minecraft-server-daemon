import { CloudWatchLogs } from "aws-sdk"
import { Option, option, some, none } from "ts-option"

const aws = require('aws-sdk')

type LogEvent = {
	message: string,
	timestamp: number
}

export default class CloudWatchLogger {
	cwl: CloudWatchLogs
	logGroupName: string
	explicitLogStreamName: Option<string>
	logStreamName: Option<string>
	cachedSequenceToken: Option<string>
	logEventQueue: Array<LogEvent>
	logEventQueueLocked: boolean
	interval: NodeJS.Timer
	
	constructor(region: string, logGroupName: string, explicitLogStreamName: Option<string>) {
		this.cwl = new aws.CloudWatchLogs({region: region})
		this.logGroupName = logGroupName
		this.explicitLogStreamName = explicitLogStreamName
		this.logStreamName = none
		this.cachedSequenceToken = none
		this.logEventQueue = []
		this.logEventQueueLocked = false
		this.interval = setInterval(this.sendBatchToCw, 1000)
	}

	info = (data: string) => {
		console.log(data)
		this.log(`INFO ${data}`)
	}

	error = (data: string) => {
		console.error(data)
		this.log(`ERROR ${data}`)
	}

	log = (data: string) => {
		this.logEventQueue.push({
			message: data,
			timestamp: Date.now()
		})
	}

	getBatchSize = () => {
		return this.logEventQueue.length
	}

	sendBatchToCw = async () => {
		if (this.logEventQueue.length > 0) {
			const expectedLogStreamName = this.explicitLogStreamName.isDefined ? this.explicitLogStreamName.get : new Date().toISOString().split(':')[0]
			if (this.logStreamName !== some(expectedLogStreamName)) {
				try {
					await this.cwl.createLogStream({
						logGroupName: this.logGroupName,
						logStreamName: expectedLogStreamName
					}).promise()
					this.cachedSequenceToken = none
					this.logStreamName = some(expectedLogStreamName)
				} catch (error) {
					console.error(error)
				}
			}
			if (this.cachedSequenceToken.isEmpty) {
				const data: CloudWatchLogs.DescribeLogStreamsResponse = await this.cwl.describeLogStreams({
					logGroupName: this.logGroupName,
					logStreamNamePrefix: this.logStreamName.get
				}).promise()
				this.cachedSequenceToken = some(option(option(data.logStreams).get[0].uploadSequenceToken).get)
			}
			try {
				this.logEventQueueLocked = true
				const data = await this.cwl.putLogEvents({
					logEvents: this.logEventQueue,
					logGroupName: this.logGroupName,
					logStreamName: this.logStreamName.get,
					sequenceToken: this.cachedSequenceToken.get
				}).promise()
				this.cachedSequenceToken = option(data.nextSequenceToken)
			} catch (error) {
				console.error(error)
			} finally {
				this.logEventQueueLocked = false
			}
		}
	}

	close = () => {
		clearInterval(this.interval)
	}
}
