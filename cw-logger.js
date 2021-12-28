class CwLogger {
	constructor(cwl, logGroupName, mirrorToConsole) {
		this.cwl = cwl
		this.logGroupName = logGroupName
		this.mirrorToConsole = mirrorToConsole
		this.logStreamName = null
		this.cachedSequenceToken = undefined
		this.logEventsQueue = []
	}

	log = (data) => {
		this.logEventsQueue.push({
			message: data,
			timestamp: Date.now()
		})
		if (this.mirrorToConsole) {
			console.log(data)
		}
	}

	getBatchSize = () => {
		return this.logEventsQueue.size
	}

	sendBatchToCw = () => {
		if (this.logEventsQueue.length > 0) {
			const currentHour = new Date().toISOString().split(':')[0]
			if (this.logStreamName !== currentHour) {
				this.cachedSequenceToken = undefined
				this.cwl.createLogStream({
					logGroupName: this.logGroupName,
					logStreamName: currentHour
				}, (err, data) => {
					if (err && err.code !== "ResourceAlreadyExistsException") {
						console.error(err)
					} else {
						this.logStreamName = currentHour
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
					this.logEventsQueue = tempLogEventsQueue
				} else {
					this.cachedSequenceToken = data.nextSequenceToken
				}
			})
		}
	}
}

module.exports = CwLogger