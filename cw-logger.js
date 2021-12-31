class CwLogger {
	constructor(cwl, logGroupName, explicitLogStreamName) {
		this.cwl = cwl
		this.logGroupName = logGroupName
		this.explicitLogStreamName = explicitLogStreamName
		this.logStreamName = null
		this.cachedSequenceToken = undefined
		this.logEventsQueue = []
	}

	log = (data) => {
		this.logEventsQueue.push({
			message: data,
			timestamp: Date.now()
		})
		console.log(data)
	}

	getBatchSize = () => {
		return this.logEventsQueue.length
	}

	sendBatchToCw = () => {
		if (this.logEventsQueue.length > 0) {
			const expectedLogStreamName = this.explicitLogStreamName ? this.explicitLogStreamName : new Date().toISOString().split(':')[0]
			if (this.logStreamName !== expectedLogStreamName) {
				this.cachedSequenceToken = undefined
				this.cwl.createLogStream({
					logGroupName: this.logGroupName,
					logStreamName: expectedLogStreamName
				}, (err, data) => {
					if (err && err.code !== "ResourceAlreadyExistsException") {
						console.error(err)
					} else {
						this.logStreamName = expectedLogStreamName
						this.sendBatchToCw()
					}
				})
				return
			}
			if (this.cachedSequenceToken === undefined) {
				this.cwl.describeLogStreams({
					logGroupName: this.logGroupName,
					logStreamNamePrefix: this.logStreamName
				}, (err, data) => {
					if (err) {
						console.error(err)
					} else {
						this.cachedSequenceToken = data.logStreams[0].uploadSequenceToken ? data.logStreams[0].uploadSequenceToken : null
						this.sendBatchToCw()
					}
				})
				return
			}
			const tempLogEventsQueue = this.logEventsQueue
			this.logEventsQueue = []
			this.cwl.putLogEvents({
				logEvents: tempLogEventsQueue,
				logGroupName: this.logGroupName,
				logStreamName: this.logStreamName,
				sequenceToken: this.cachedSequenceToken
			}, (err, data) => {
				if (err) {
					console.error(err)
					this.cachedSequenceToken = undefined
					this.logEventsQueue = tempLogEventsQueue
				} else {
					this.cachedSequenceToken = data.nextSequenceToken
				}
			})
		}
	}
}

module.exports = CwLogger