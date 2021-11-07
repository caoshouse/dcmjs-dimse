const { Association, PresentationContext } = require('./Association');
const Network = require('./Network');
const { Request } = require('./Command');
const log = require('./log');

const AsyncEventEmitter = require('async-eventemitter');
const { Socket } = require('net');

//#region Client
class Client extends AsyncEventEmitter {
  /**
   * Creates an instance of Client.
   * @constructor
   */
  constructor() {
    super();
    this.requests = [];
    this.additionalPresentationContexts = [];
  }

  /**
   * Adds a request.
   * @method
   * @param {Request} request - DICOM request.
   * @throws Error if request is not an instance of the Request class.
   */
  addRequest(request) {
    // Check if request is actually a request!
    if (!(request instanceof Request)) {
      throw new Error(`${request.toString()} is not a request.`);
    }
    // Prevent duplicates
    if (this.requests.includes(request)) {
      return;
    }
    this.requests.push(request);
  }

  /**
   * Clears all requests.
   * @method
   */
  clearRequests() {
    this.requests.length = 0;
  }

  /**
   * Adds an additional presentation context.
   * @method
   * @param {PresentationContext} context - Presentation context.
   * @throws Error if request is not an instance of the Request class.
   */
  addAdditionalPresentationContext(context) {
    // Check if request is actually a context!
    if (!(context instanceof PresentationContext)) {
      throw new Error(`${context.toString()} is not a presentation context.`);
    }
    // Prevent duplicates
    if (this.additionalPresentationContexts.includes(context)) {
      return;
    }
    this.additionalPresentationContexts.push(context);
  }

  /**
   * Sends requests to the remote host.
   * @method
   * @param {string} host - Remote host.
   * @param {number} port - Remote port.
   * @param {string} callingAeTitle - Local AE title.
   * @param {string} calledAeTitle - Remote AE title.
   * @param {Object} [opts] - Network options.
   * @param {number} [opts.connectTimeout] - Connection timeout in milliseconds.
   * @param {number} [opts.associationTimeout] - Association timeout in milliseconds.
   * @param {number} [opts.pduTimeout] - PDU timeout in milliseconds.
   * @param {number} [opts.associationLingerTimeout] - Association linger timeout in milliseconds.
   * @param {boolean} [opts.logCommandDatasets] - Log DIMSE command datasets.
   * @param {boolean} [opts.logDatasets] - Log DIMSE datasets.
   * @throws Error if there are zero requests to perform.
   */
  send(host, port, callingAeTitle, calledAeTitle, opts) {
    opts = opts || {};
    this.associationLingerTimeout = opts.associationLingerTimeout || 0;

    // Check for requests
    if (this.requests.length === 0) {
      throw new Error('There are no requests to perform.');
    }

    // Create association object
    const association = new Association(callingAeTitle, calledAeTitle);
    this.requests.forEach((request) => {
      association.addPresentationContextFromRequest(request);
    });

    // Add additional presentation contexts
    this.additionalPresentationContexts.forEach((context) => {
      const pcId = association.addOrGetPresentationContext(context.getAbstractSyntaxUid());
      const transferSyntaxes = context.getTransferSyntaxUids();
      transferSyntaxes.forEach((transferSyntax) => {
        association.addTransferSyntaxToPresentationContext(pcId, transferSyntax);
      });
    });

    // Initialize network
    const socket = new Socket();
    const network = new Network(socket, opts);
    network.on('connect', () => {
      this.emit('connected');
      network.sendAssociationRequest(association);
    });
    network.on('associationAccepted', (association) => {
      this.emit('associationAccepted', association);
      network.sendRequests(this.requests);
    });
    network.on('associationReleaseResponse', () => {
      this.emit('associationReleased');
      socket.end();
    });
    network.on('associationRejected', (result, source, reason) => {
      this.emit('associationRejected', result, source, reason);
      socket.end();
    });
    network.on('done', () => {
      setTimeout(() => network.sendAssociationReleaseRequest(), this.associationLingerTimeout);
    });
    network.on('cStoreRequest', (request, callback) => {
      this.emit('cStoreRequest', request, callback);
    });
    network.on('nEventReportRequest', (request, callback) => {
      this.emit('nEventReportRequest', request, callback);
    });
    network.on('networkError', (err) => {
      socket.end();
      this.emit('networkError', err);
    });
    network.on('close', () => {
      this.emit('closed');
    });

    // Connect
    log.info(`Connecting to ${host}:${port}`);
    socket.connect({ host, port });
  }
}
//#endregion

//#region Exports
module.exports = Client;
//#endregion
