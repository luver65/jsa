/*#####################################################################################
  NAME: JavaScript for Archer Library (JSALib)
  AUTHOR: Luciano Veronese
  DATE: July 2020
  VERSION: 1.4
  DESCRIPTION: set of Javascript functions to read/write the most typical Archer field
  types using the REST APIs. These functions support two types of sessions:
  - Internal Session: the APIs are called within a custom object. In this case no credentials
  are required as the current session is used
  - External Session: the APIs are invoked from an application external to Archer. In this
  case the credentials are needed to establish the session.
  As the session is created, it is reused across the various API calls.
  All the calls are asynchronous, so they are not blocking.
  The library uses many featurs of ES&, so only the most recent we browsers are supported (sorry, no IE11)

  DEPENDENCIES: JQuery (just for the GetJSONfromHTML function)

  NOTES
  - Calling these APIs from an external domain (outside a custom object) may lead to
    CORS issues. Use the Chrome extension "Allow CORS: Access-Control-Allow-Origin" to bypass CORS checks
  - Identifiers
    - Module Id = Numeric Id of the Application, Questionnaire or Sub Form
  - The spread operator to copy objects does not copy the class properites like the setters/getters
  - Any error thrown in the context of asyc calls, bubbles up to the .catch statement of the promise response
  - The RecordId can be 0. This happens when a content record is new and not yet saved
  TYPICAL ERRORS:
  - 401: Authz Error, the Archer session is probably old and expired. Session token is stored in the session storage. Close and reopen the browser tab
  - 405: Method not allowed: POST  or GET are not supported or require the override
  #####################################################################################*/

var JSA = (function () { // All the library functions are wrapped in a module usin the simple module pattern
    /*-------------------------------------------------------------------------------------
                                HELPER FUNCTIONS AND DATA STRUCTURES
    -------------------------------------------------------------------------------------*/
    const FetchRequestTemplate = {
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Cache-Control': 'no-cache',
            //            'accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,/;q=0.8',
            'content-type': 'application/json; charset=utf-8'
        }
    };
    // If a JSON object is found in the input HTML, then this is returned as an object
    // otherwise null is returned (basically the JSON object is filtered)
    function GetJSONfromHTML(desc) {
        let txt = jQuery(desc).text();
        if (txt != "")
            try {
                let jdesc = JSON.parse(txt);
                return (jdesc);
            } catch (e) {
                return (null)
            }
        else
            return (null);
    }

    class ArcherSessions {
        constructor(Scope, Baseurl, csrfToken, SessionToken) {
            this.Scope = Scope;
            this.Baseurl = Baseurl;
            this.csrfToken = csrfToken;
            this.SessionToken = SessionToken;
            this.AppList = [];
            this.metaCache = null;
        }
        setRecordFields(fields) {
            this.RecordFields = [...fields];
        }
        getRecordFields() {
            return (this.RecordFields);
        }
    }

    class VLItems {
        constructor(Name, NameId, ParentName, ParentId, Description, NumericValue, SortOrder) {
            this._Name = Name;
            this._ParentName = ParentName;
            this._Status = '';
            this._SortOrder = SortOrder;
            this._Step = null;
            this._SubStep = null;
            this._Description = Description;
            this._NumericValue = NumericValue;
            this._NameId = NameId;
            this._ParentId = ParentId;
            this._IsFirst = false;
            this._IsLast = false;
        }
        get Name() {
            return (this._Name);
        }
        set Name(name) {
            this._Name = name;
        }
        get NameId() {
            return (this._NameId)
        }
        set NameId(name) {
            this._NameId = name;
        }
        get ParentName() {
            return (this._ParentName);
        }
        set ParentName(pname) {
            this._ParentName = pname;
        }
        get ParentId() {
            return (this._ParentId);
        }
        set ParentId(pid) {
            this._ParentId = pid;
        }
        get Description() {
            return (this._Description);
        }
        set Description(desc) {
            this._Description = desc;
        }
        get NumericValue() {
            return (this._NumericValue);
        }
        set NumericValue(nv) {
            this._NumericValue = nv;
        }
        get SortOrder() {
            return (this._SortOrder);
        }
        set SortOrder(so) {
            this._SortOrder = so;
        }
        get Status() {
            return (this._Status);
        }
        set Status(sts) {
            this._Status = sts;
        }
        get Step() {
            return (this._Step);
        }
        set Step(st) {
            this._Step = st;
        }
        get SubStep() {
            return (this._SubStep);
        }
        set SubStep(ss) {
            this._SubStep = ss;
        }
        get IsFirst() {
            return (this._IsFirst);
        }
        set IsFirst(sts) {
            this._IsFirst = sts;
        }
        get IsLast() {
            return (this._IsLast);
        }
        set IsLast(sts) {
            this._IsLast = sts;
        }
    }

    /* FIELD TYPE CODING REFERENCE
        1: 'Text',
        2: 'Numeric',
        3: 'Date',
        4: 'Values List',
        7: 'External Links',
        8: 'Record Permissions',
        9: '"Tag":"',
        11: 'Attachments',
        12: 'Image',
        13: 'Ip Address',
        24: 'Subforms'
    */

    function MakeError(errcode, errtext) {
        return (JSON.stringify({
            code: errcode,
            text: errtext
        }));
    }

    function AddSessionTokenToHeaders(ThisArcherSession, FetchRequest) {
        // Depending on the type of session, att the proper authorization token
        if (ThisArcherSession.Scope == 'Internal') {
            FetchRequest.headers = {
                ...FetchRequest.headers,
                ...{
                    'x-csrf-token': ThisArcherSession.csrfToken
                }
            }
        } else {
            FetchRequest.headers.Authorization = 'Archer session-id="' + ThisArcherSession.SessionToken + '"';
        }
        return;
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetApplicationList
     GOAL: Get some information attributes of the selected set of applications
     INPUT: Archer session, a template to select the metadata and a filter to select the
     applications to include in the output. The following is an example of the template syntax
        - Sample select template "Name,Id,Alias,Description,Status"
        - Sample filter template "Alias eq 'Hazards' or Alias eq 'Threats'"
     RETURN: a map whose key is the application alias and the value is the object with
     the required metadata
    -------------------------------------------------------------------------------------*/
    jsaGetApplicationList = async (ThisArcherSession, selectTemplate = "Name,Id,Alias,Description,Status", filterTemplate = "") => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetApplicationList] - No Active Session'));

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/system/application";
        let request = {
            ...FetchRequestTemplate
        };
        AddSessionTokenToHeaders(ThisArcherSession, request);

        // To avoid putting the OData in the request url, a POST with a GET override is created
        request.method = 'POST';
        // Build the body to specify the metadata to pull and the applications to filter
        request.body = JSON.stringify({
            Value: `?$orderby=Name${selectTemplate!=""?"&$select="+selectTemplate:""}${filterTemplate!=""?"&$filter="+filterTemplate:""}`
        });
        request.headers = {
            ...request.headers,
            ...{
                'X-Http-Method-Override': 'GET'
            }
        }

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();

        // Build the output map
        let appmeta = new Map();
        jresp.forEach((item) => appmeta.set(item.RequestedObject.Alias, item.RequestedObject));
        return (appmeta);
    }

    /*-------------------------------------------------------------------------------------
    Name: jsaGetApplicationMeta
    GOAL: Get some selected metadata (like the LevelId) of a selected set of applications
    INPUT: Archer session, a template to select the metadata and a filter to select the
    applications to include in the output.  
    RETURN: a map whose key is the application alias and the value is the object with
    the metadata
    -------------------------------------------------------------------------------------*/
    jsaGetApplicationMeta = async (ThisArcherSession, selectTemplate = "Name,Alias,ModuleId,Id", filterTemplate = "") => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetApplicationMeta] - No Active Session'));

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/system/level";
        let request = {
            ...FetchRequestTemplate
        };
        AddSessionTokenToHeaders(ThisArcherSession, request);

        // To avoid putting the OData in the request url, a POST with a GET override is created
        request.method = 'POST';
        // Build the body to specify the metadata to pull and the applications to filter
        request.body = JSON.stringify({
            Value: `?$orderby=Name${selectTemplate != "" ? "&$select=" + selectTemplate : ""}${filterTemplate != "" ? "&$filter=" + filterTemplate : ""}`
        });
        request.headers = {
            ...request.headers,
            ...{
                'X-Http-Method-Override': 'GET'
            }
        }
        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();

        // Build the output map
        let appmeta = new Map();
        jresp.forEach((item) => appmeta.set(item.RequestedObject.Alias, item.RequestedObject));
        return (appmeta);
    }


    /*-------------------------------------------------------------------------------------
     Name: jsaGetRecordFieldMeta
     GOAL: Returns some selected data of the Archer fields mapped by FieldId and Alias
     INPUT:  an Archer session object and RecordId
     RETURN: an object with LevelId and two maps to access some content fields 
     by FieldId or Alias. If record is new, RecordId is null, so null is returned
    -------------------------------------------------------------------------------------*/
    jsaGetRecordFieldMeta = async (ThisArcherSession, RecordId) => {

        if (ThisArcherSession === null)
            throw Error(MakeError(0, '[jsaGetRecordFieldMeta] - No Active Session'));
        if ((RecordId === null) || (RecordId === 0)) {
            console.log(`%c[jsaGetRecordFieldMeta] - RecordId is null or zero => New Record`, 'color: #CC0000');
            return (null);
        }
        //--------------------------------------------------------------------
        // Build a Fetch request to GET the Content for the specified RecordId
        const contentRequrl = ThisArcherSession.Baseurl + "platformapi/core/content/" + RecordId;
        let contentRequest = {
            ...FetchRequestTemplate
        };
        contentRequest.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, contentRequest);

        let contentFresp = await fetch(contentRequrl, contentRequest);
        if (!contentFresp.ok)
            throw Error(MakeError(contentFresp.status, contentFresp.statusText));

        let contentJresp = await contentFresp.json();
        if (contentJresp.RequestedObject == null)
            throw Error('[jsaGetRecordFieldMeta] - JSON ERROR (content data)');

        let contentObj = contentJresp.RequestedObject;
        let LevelId = contentObj.LevelId;

        //--------------------------------------------------------------------
        // Build a Fetch request to GET the Metadata for the specified LevelId
        // As the LevelId is needed, it's not possible to run asynchronously 
        // this fetch request and the previous one
        const metaRequrl = ThisArcherSession.Baseurl + "platformapi/core/system/fielddefinition/level/" + LevelId;
        let metaRequest = {
            ...FetchRequestTemplate
        };
        metaRequest.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, metaRequest);
        let metaFresp = await fetch(metaRequrl, metaRequest);
        if (!metaFresp.ok)
            throw Error(MakeError(metaFresp.status, metaFresp.statusText));
        let metaJresp = await metaFresp.json();
        if (metaJresp === null)
            throw Error('[jsaGetRecordFieldMeta] - JSON ERROR (meta data)');

        //-------------------------------------------------
        // Build the data stuctures to return to the caller

        // First build a simple "Field-Id - Alias" map
        let fieldObj;
        let AliasIdMap = new Object();
        metaJresp.forEach((field) => {
            fieldObj = field.RequestedObject;
            AliasIdMap[fieldObj.Id] = fieldObj.Alias;
        });
        // The next two maps are defined to access the content by FieldId or by Alias
        let AliasByFieldId = new Map();
        let FieldIdByAlias = new Map();
        for (let fieldId in contentObj.FieldContents) {
            AliasByFieldId.set(fieldId, AliasIdMap[fieldId]);
            FieldIdByAlias.set(AliasIdMap[fieldId], fieldId);
        }
        return ({
            LevelId: LevelId,
            AliasByFieldId: AliasByFieldId,
            FieldIdByAlias: FieldIdByAlias,
            //LastUpdateStr: metaJresp['0'].RequestedObject.UpdateInformation.UpdateDate
        });
    }


    /*-------------------------------------------------------------------------------------
     Name: jsaGetAllUsers
     GOAL: Returns the list of all the Archer users in the instance
     INPUT: ThisArcherSession and OData options
     RETURN: An Array of JSON data
    -------------------------------------------------------------------------------------*/
    jsaGetAllUsers = async (ThisArcherSession, options) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetAllUsers] - No Active Session'));

        // Build Fetch request
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/system/user" + options;
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        let fresp = await fetch(requrl, request)
        if (!fresp.ok)
            throw Error(MakeError(fresp.code, fresp.statusText));
        let jresp = await fresp.json();
        if (jresp.RequestedObject == null)
            throw Error(MakeError(0, '[jsaGetAllUsers] - JSON ERROR'));
        return (jresp);
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetSession
     GOAL: Setup an Archer session or attach to the current one (when the function is invoked 
        in a custom object. When invoked outside a custom object, the baseurl and credentials
        must me provided.
     INPUT: none, when invoked in a custom object, otherwise the instance url and credentials
     
     RETURN: A promise (async function) whose return value embeds the ArcherSession object
     {
      Scope: "Internal" | "External" (Internal=in a custom object)
      csrfToken: not null if a valid session is created from a custom object
      SessionToken: not null if a valid session is created from external calls
      BaseUrl: the url of the Archer instance
     }
    -------------------------------------------------------------------------------------*/
    jsaGetSession = async (baseurl = "", username = "", instance = "", password = "") => {

        let NewArcherSession, CurrentRecordId = null,
            baseURL; // RecordId set only for internal sessions
        //-------------------------------------------------------
        // If the csrfToken is set, the session is being created 
        // from within an active session (custom object)    
        csrfToken = window.sessionStorage ? window.sessionStorage.getItem("x-csrf-token") : parent.parent.ArcherApp.globals['xCsrfToken'];
        if (csrfToken) {
            // Get the baseurl from the current session: this will be used in the REST calls
            baseURL = window.location.protocol + '//' + window.location.host + parent.parent.ArcherApp.globals['baseUrl'];
            if (baseURL.endsWith("/") == false)
                baseURL += "/";
            //  A singleton is not used as the script lifecyle is the same as the page's
            NewArcherSession = new ArcherSessions('Internal', baseURL, csrfToken, null);
            CurrentRecordId = getRecordId();
            //console.log(`%c[jsaGetSession] - EXISTING internal session (csrfToken) detected for RecordId: ${CurrentRecordId}`, 'color: #0000CC');
        }
        //-------------------------------------------------------
        // If the csrfToken is set, the session must be created 
        if (!csrfToken) {
            // At this stage, an external session must be either detected 
            // (because it's been cached) or created... but we need to set the baseurl anyway
            if (baseurl != '') {
                if (baseurl.endsWith("/") == false)
                    baseurl += "/";
            } else {
                throw Error('[jsaGetSession] - Archer URL not defined');
            }
            CurrentArcherSessionToken = sessionStorage.getItem("CurrentArcherSessionToken");
            //--------------------------------------------------------
            // If no csrfToken exist, check if an external session has 
            // already been created, and return the session immediately
            baseURL = baseurl;
            if (CurrentArcherSessionToken != null) {
                //console.log(`%c[jsaGetSession] - EXISTING external session detected - SessionToken: "${CurrentArcherSessionToken}" RecordId: ${CurrentRecordId}`, 'color: #0000FF');
                NewArcherSession = new ArcherSessions('External', baseurl, null, CurrentArcherSessionToken, CurrentRecordId);
                return (NewArcherSession);
            } else {
                //--------------------------------------------------------
                try {
                    //console.log(`%c[jsaGetSession] - NEW external session request for RecordId ${CurrentRecordId}`, 'color: #0000FF');
                    // Create a new session: build the Fetch request
                    let request = {
                        ...FetchRequestTemplate
                    }
                    request.method = 'POST';
                    request.body = JSON.stringify({
                        InstanceName: instance,
                        Username: username,
                        UserDomain: "",
                        Password: password
                    });
                    // Invoke the Fetch request and wait response
                    let fresp = await fetch(baseurl + "platformapi/core/security/login", request)
                    if (!fresp.ok)
                        throw Error('[jsaGetSession] - ' + fresp.statusText);
                    let jresp = await fresp.json();
                    if (jresp.RequestedObject == null)
                        throw Error('[jsaGetSession] - JSON ERROR');
                    let SessionToken = jresp.RequestedObject.SessionToken;
                    sessionStorage.setItem("CurrentArcherSessionToken", SessionToken);
                    console.log(`%c[jsaGetSession] - NEW external session created - SessionToken: ${SessionToken}`, 'color: #CC0000');
                    NewArcherSession = new ArcherSessions('External', baseurl, null, SessionToken, CurrentRecordId);
                    return (NewArcherSession);
                } catch (e) {
                    console.warn('%c[jsaGetSession] - ERROR INVALID SESSION detected: CLEARED, retry login', 'color: #CC0000');
                    sessionStorage.removeItem("CurrentArcherSessionToken");
                }
            }
        }

        // Now the session is created. To allow the reference by alias instead of FieldId
        // the REST call to fetch Field Meta is invoked and the mapping stored in session
        // to allow reuse. This call takes time, but the alias-FieldId mapping does not
        // change often, so a simple cache is added to stored the mapping into the 
        // browser localStorage
        const request = {
            ...FetchRequestTemplate
        };
        request.method = 'GET';
        AddSessionTokenToHeaders(NewArcherSession, request);

        const fresp = await fetch(baseURL + "platformapi/core/content/" + getRecordId(), request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        const jresp = await fresp.json();
        const LastUpdatedISO = jresp.RequestedObject.LastUpdated;

        // Cache the Field Metadata usaing a "change detect" cache with 1 hour of timeout
        // This means that every hour, if the record is updated, the metadata is read 
        // through APIs, otherwise it's read from the cache
        this.metaCache = new jsaSimpleCache('JSAFieldMeta', CurrentRecordId, 3600);

        // Probe (read) the cached metadata within a TMO period of the last record update
        let cachedMeta = metaCache.Load(LastUpdatedISO);
        if (cachedMeta == null) {
            // If the cache is empty or the timeout is expired and for 
            //  an Internal Session is available, read the field meta data
            // that will allow to use the field alias instead of the fieldId
            await jsaGetRecordFieldMeta(NewArcherSession, CurrentRecordId)
                .then((resp) => {
                    NewArcherSession.RecordFields = resp;
                    // The metadata is now cached, but it must first be serialized into a string
                    let serialized = {
                        LevelId: resp.LevelId,
                        serAliasByFieldId: JSON.stringify([...resp.AliasByFieldId]),
                        serFieldIdByAlias: JSON.stringify([...resp.FieldIdByAlias])
                    }
                    // As a reference date, the lastupdate is used, so that the cache is refreshed only
                    // when the record is updated or the timeout expired
                    metaCache.Write(serialized, LastUpdatedISO);
                }).catch(e => {
                    let eobj = JSON.parse(e.message);
                    if (eobj.code == 401) { // Detect invalid session to clear the session cache
                        sessionStorage.removeItem("CurrentArcherSessionToken");
                        console.warn('%c[jsaGetSession] - ERROR INVALID SESSION detected: CLEARED, retry login', 'color: #CC0000');
                    }
                    throw Error(MakeError(eobj.code, eobj.text)); // Rethrow the error to bubble up
                });
        } else {
            // Use the cached information
            let dest = {
                LevelId: cachedMeta.LevelId,
                AliasByFieldId: new Map(JSON.parse(cachedMeta.serAliasByFieldId)),
                FieldIdByAlias: new Map(JSON.parse(cachedMeta.serFieldIdByAlias))
            }
            NewArcherSession.RecordFields = {
                ...dest
            };
        }

        return (NewArcherSession);
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetContentById
     GOAL: Read, using the content APIs, the content of a record.
     An optional Context object can be passed and this will be included, untouched, in the
     returned object. This is useful to correlate the fetach request with the returned promise
     when multiple fetch requests are issued in parallel
     INPUT: See the signature...
     RETURN: JSON object with the data and context
    -------------------------------------------------------------------------------------*/
    jsaGetContentById = async (ThisArcherSession, LevelAlias, ContentId, ThisContext = {}) => {

        const params = [ThisArcherSession, LevelAlias, ContentId];
        if (params.includes(undefined) || params.includes(null)) {
            throw Error(MakeError(0, '[jsaGetContentById] - Wrong input parameters'));
        }

        // Build Fetch request /contentapi/LevelAlias(content_id)
        const requrl = `${ThisArcherSession.Baseurl}contentapi/${LevelAlias}(${ContentId})`;
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        return (
            fetch(requrl, request)
            .then((response) => {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.indexOf('application/json') !== -1) {
                    return response.json().then((json) => {
                        if (response.ok) { // Received good JSON data
                            return ({
                                data: json,
                                context: ThisContext
                            })
                        }
                        console.log("[jsaGetContentById] - JSON FAILED REQUEST", request);
                        console.log("[jsaGetContentById] - JSON FAILED RESPONSE", response);
                        // Error response received. Reject the promise with the appropriate message.
                        const userMsg = `[jsaGetContentById] - JSON data error @url=${response.url}: status=${response.status}, statusText=${response.statusText}`;
                        return Promise.reject(userMsg);
                    });
                }
                if (!response.ok) {
                    // The fetch request failed and no JSON is available. The typical error Error 404 or 500
                    const errorMsg = `[jsaGetContentById] - Unexpected error @url=${response.url}: status=${response.status}, statusText="${response.statusText}"`;
                    return Promise.reject(errorMsg);
                }
                return response;
            })
        );
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaSetFielContentById
     GOAL: Set a field for the given application and record using the ContentAPIs
     INPUT: See the signature...
     RETURN: A promise 
    -------------------------------------------------------------------------------------*/
    jsaSetFielContentById = async (ThisArcherSession, LevelAlias, KeyFieldAlias, ContentId, FieldAlias, Value) => {

        const params = [ThisArcherSession, LevelAlias, KeyFieldAlias, ContentId, FieldAlias, Value];
        if (params.includes(undefined) || params.includes(null)) {
            console.error(`[jsaSetFielContentById] - Wrong input parameters`);
            return;
        }

        // Build the Fetch request to update the text
        const requrl = `${ThisArcherSession.Baseurl}contentapi/${LevelAlias}`
        let request = {
            ...FetchRequestTemplate
        };

        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        // Build the payload
        request.body = `{
            "${KeyFieldAlias}": ${ContentId},
            "${FieldAlias}": "${Value}"
        }`
        return (
            fetch(requrl, request)
            .then((response) => {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.indexOf('application/json') !== -1) {
                    return response.json().then((json) => {
                        if (response.ok) { // Received good JSON data
                            console.log(`[jsaSetDateValue] - `, json);
                            return (true)
                        }
                        return Promise.reject(`[jsaSetDateValue] - JSON data error @url=${response.url}: status=${response.status}, statusText=${response.statusText}`);
                    });
                }
                if (!response.ok) {
                    // The fetch request failed and no JSON is available. The typical error Error 404 or 500
                    return Promise.reject(`[jsaSetDateValue] - Unexpected error @url=${response.url}: status=${response.status}, statusText="${response.statusText}"`);
                }
                return response;
            })
        );
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetNumericValue
     GOAL: Returns the value of the numeric field type defined by the field Id
     INPUT: ThisArcherSession, the record's ContenId and the numeric field Id
     RETURN: The number associated to the Field Id
    -------------------------------------------------------------------------------------*/
    jsaGetNumericValue = async (ThisArcherSession, ContentId, NumericFieldId) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetNumericValue] - No Active Session'));
        if (typeof NumericFieldId == 'undefined')
            throw Error(MakeError(0, '[jsaGetNumericValue] - NumericFieldId is undefined'));

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content/fieldcontent";
        // Initialize the request
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        request.body = JSON.stringify({
            FieldIds: [NumericFieldId],
            ContentIds: [ContentId]
        });
        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        // FieldContent is always stored in an array of objects
        let numfield = jresp['0'].RequestedObject.FieldContents[NumericFieldId];

        if (numfield.Type != 2)
            throw Error(MakeError(0, 'FieldId ' + NumericFieldId + ' is not a number'));
        nval = jresp['0'].IsSuccessful ? numfield.Value : null;
        return ({
            LevelId: jresp['0'].RequestedObject.LevelId,
            Type: numfield.Type,
            Value: nval
        });
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetTextValue
     GOAL: Returns the value of the text/tex area field type defined by the field Id
     INPUT: ThisArcherSession, the record's ContenId and the numeric field Id
     RETURN: The text associated to the Field Id
    -------------------------------------------------------------------------------------*/
    jsaGetTextValue = async (ThisArcherSession, ContentId, TextFieldId) => {
        //("[jsaGetTextValue] - START"); 
        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetTextValue] - No Active Session'));

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content/fieldcontent";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        request.body = JSON.stringify({
            FieldIds: [TextFieldId],
            ContentIds: [ContentId]
        });

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        // FieldContent is always stored in an array of objects
        let textfield = jresp['0'].RequestedObject.FieldContents[TextFieldId];
        if (textfield.Type != 1)
            throw Error(MakeError(0, '[jsaGetTextValue] - FieldId ' + TextFieldId + ' NOT TEXT TYPE'));
        textval = jresp['0'].IsSuccessful ? textfield.Value : null;
        return ({
            LevelId: jresp['0'].RequestedObject.LevelId,
            Type: textfield.Type,
            Value: textfield.Value
        });
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetDateValue
     GOAL: Returns the value of the date field type defined by the field Id
     INPUT: ThisArcherSession, the record's ContenId and the date field Id
     RETURN: An object with the levelid, type and value (the date in string format)
    -------------------------------------------------------------------------------------*/
    jsaGetDateValue = async (ThisArcherSession, ContentId, DateFieldId) => {

        if (typeof DateFieldId === 'undefined')
            throw Error(MakeError(0, '[jsaGetDateValue]> ERROR - FieldId is undefined'));

        let dateval = null;
        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetDateValue] - No Active Session'));

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content/fieldcontent";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        request.body = JSON.stringify({
            FieldIds: [DateFieldId],
            ContentIds: [ContentId]
        });

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        // FieldContent is always stored in an array of objects
        let datefield = jresp['0'].RequestedObject.FieldContents[DateFieldId];
        if (datefield.Type != 3)
            throw Error(MakeError(0, '[jsaGetDateValue] - FieldId ' + DateFieldId + ' NOT DATE TYPE'));
        return ({
            LevelId: jresp['0'].RequestedObject.LevelId,
            Type: datefield.Type,
            Value: jresp['0'].IsSuccessful ? datefield.Value : null
        });
    }


    /*-------------------------------------------------------------------------------------
     Name: jsaSetTextValue 
     GOAL: Updates the target FieldIf of the target RecordId to the specific text Value
     INPUT:
     RETURN: true or throws an error
    -------------------------------------------------------------------------------------*/
    jsaSetTextValue = async (ThisArcherSession, ContentId, TextFieldId, TextValue) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaSetTextValue] - No Active Session'));
        if (!((typeof (TextValue) === 'string') && (TextValue != '')))
            throw Error(MakeError(0, '[jsaSetTextValue]> ERROR - Input Value is not a string or it\'s empty'));

        // Read the current value of text field in order to get the LevelId needed by the update REST call
        let jcvresp = await jsaGetTextValue(ThisArcherSession, ContentId, TextFieldId);

        // Build the Fetch request to update the text
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'PUT';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        // Build the payload
        let Payload = {
            Content: {
                Id: ContentId,
                LevelId: jcvresp.LevelId,
                FieldContents: {
                    [TextFieldId]: {
                        Type: 1,
                        Value: TextValue,
                        FieldId: TextFieldId
                    }
                }
            }
        }
        request.body = JSON.stringify(Payload);
        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        if (jresp.IsSuccessful) {
            return (true);
        } else {
            console.error(`[jsaSetTextValue] - ERROR updating the Text value (MessageKey: "${jresp.ValidationMessages[0].MessageKey}")`);
            console.error('[jsaSetTextValue] - ValidationMessages details:', jresp.ValidationMessages);
        }
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaSetNumericValue 
     GOAL: Updates the target FieldId of the target RecordId to the specific mumeric Value
     INPUT:
     RETURN: true or throws an error
    -------------------------------------------------------------------------------------*/
    jsaSetNumericValue = async (ThisArcherSession, ContentId, NumFieldId, NumValue) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaSetNumericValue] - No Active Session'));
        if ((typeof NumValue != 'number') || isNaN(NumValue))
            throw Error(MakeError(0, '[jsaSetNumericValue]> ERROR - Input Value is not a number'));

        // Read the current value of numeric field in order to get the LevelId needed by the update REST call
        let jcvresp = await jsaGetNumericValue(ThisArcherSession, ContentId, NumFieldId);
        //console.log(`[jsaSetNumericValue]>CURRENT VALUE: ${jcvresp.Value} (LevelId: ${jcvresp.LevelId}, Type: ${jcvresp.Type})`);

        // Build the Fetch request to update the text
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'PUT';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        // Build the payload
        let Payload = {
            Content: {
                Id: ContentId,
                LevelId: jcvresp.LevelId,
                FieldContents: {
                    [NumFieldId]: {
                        Type: 2,
                        Value: NumValue,
                        FieldId: NumFieldId
                    }
                }
            }
        }
        request.body = JSON.stringify(Payload);

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        if (jresp.IsSuccessful) {
            return (true);
        } else {
            console.error(`[jsaSetNumericValue] - ERROR updating the Numeric value (MessageKey: "${jresp.ValidationMessages[0].MessageKey}")`);
            console.error('[jsaSetNumericValue] - ValidationMessages details:', jresp.ValidationMessages);
        }
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaSetDateValue 
     GOAL: Updates the target FieldId of the target RecordId to the specific date Value
     INPUT:
     RETURN: true or throws an error
    -------------------------------------------------------------------------------------*/
    jsaSetDateValue = async (ThisArcherSession, ContentId, DateFieldId, DateValue) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaSetDateValue] - No Active Session'));
        if (typeof ContentId === 'undefined')
            throw Error(MakeError(0, '[jsaSetDateValue]> ERROR - ContentId is undefined'));
        if (!((typeof (DateValue) === 'string') && (DateValue != '')))
            throw Error(MakeError(0, '[jsaSetDateValue]> ERROR - Input Value is not a date or it\'s empty'));
        if (typeof DateFieldId === 'undefined')
            throw Error(MakeError(0, '[jsaSetDateValue]> ERROR - FieldId is undefined'));

        // Build the Fetch request to update the text
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'PUT';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        // Build the payload
        let Payload = {
            Content: {
                Id: ContentId,
                LevelId: ThisArcherSession.RecordFields.LevelId,
                FieldContents: {
                    [DateFieldId]: {
                        Type: 3,
                        Value: DateValue,
                        FieldId: DateFieldId
                    }
                }
            }
        }
        request.body = JSON.stringify(Payload);
        console.log(request.body);
        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        if (jresp.IsSuccessful) {
            return (true);
        } else {
            console.error(`[jsaSetDateValue] - ERROR updating the Date value (MessageKey: "${jresp.ValidationMessages[0].MessageKey}")`);
            console.error('[jsaSetDateValue] - ValidationMessages details:', jresp.ValidationMessages);
            return (false);
        }
    }


    /*-------------------------------------------------------------------------------------
     Name: jsaGetKeyFieldMetadata
     GOAL: Returns some key metadata about the Field Id
     INPUT: ThisArcherSession, Field Id
     RETURN: Values List Id, Level Id and Type of the field in input
    -------------------------------------------------------------------------------------*/
    jsaGetKeyFieldMetadata = async (ThisArcherSession, VLFieldID) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetKeyFieldMetadata] - No Active Session'));

        // Build Fetch request
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/system/fielddefinition/" + VLFieldID;
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        if (jresp.RequestedObject.Type != 4)
            throw Error(MakeError(0, '[jsaGetKeyFieldMetadata]-WRONG FIELD TYPE for Field ID ' + VLFieldID + ', expected Values List Type'));
        return ({
            RelatedValuesListId: typeof jresp.RequestedObject.RelatedValuesListId != "undefined" ? jresp.RequestedObject.RelatedValuesListId : null,
            LevelId: jresp.RequestedObject.LevelId,
            Type: jresp.RequestedObject.Type,
            Name: jresp.RequestedObject.Name
        });
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetValuesListDefinition
     GOAL: Returns the VL Item IDs, Names and Parent associated to the Values List Id
     INPUT: ThisArcherSession, Values List Id
     RETURN: Map Key=VL Item Id  Value = {Name=<VL Item Name>, ParentId: <Parent node VL Item Id > }
    -------------------------------------------------------------------------------------*/
    jsaGetValuesListDefinition = async (ThisArcherSession, VLID) => {
        //(`[jsaGetValuesListDefinition] - START - VL Id:${VLID}`);
        // Build Fetch request
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/system/valueslistvalue/flat/valueslist/" + VLID;
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'GET';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(0, fresp.status, fresp.statusText));
        let jresp = await fresp.json();
        let vlmap = new Map(); //Selected Values List Items
        for (let item of jresp) {
            let ro = item.RequestedObject;
            vlmap.set(ro.Id, new VLItems(ro.Name, ro.Id, "", ro.ParentId, ro.Description, ro.NumericValue, ro.SortOrder));
        }
        return (vlmap);
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaGetValuesListValues
     GOAL: Returns the items set in the values list field type
     INPUT: ThisArcherSession and OData options
     RETURN: An Array of objects with the selected parent/child items, null if no items are selected
    -------------------------------------------------------------------------------------*/
    jsaGetValuesListValues = async (ThisArcherSession, ContentId, VLFieldId) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaGetValuesListValues] - No Active Session'));

        // Get the Values List Id from the Field Id
        let vlretcode = await jsaGetKeyFieldMetadata(ThisArcherSession, VLFieldId);
        let ValuesListId = vlretcode.RelatedValuesListId;

        // Get the definition (map) of the Values List Items and a selection of their attributes
        let vlidef = await jsaGetValuesListDefinition(ThisArcherSession, ValuesListId);
        // Enrich each object in the map with the name of the parent values list
        for (const k of vlidef.keys()) {
            let pid = (vlidef.get(k)).ParentId;
            vlidef.get(k).ParentName = pid != null ? vlidef.get(pid).Name : "";
        }

        // Build Fetch request to get the list of Values List Ids selected in the Values List
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content/fieldcontent";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        request.body = JSON.stringify({
            FieldIds: [VLFieldId],
            ContentIds: [ContentId]
        });

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(fresp.status, fresp.statusText));
        let jresp = await fresp.json();

        let svlitems = [];
        // Build the Selected Values List Items array to return
        if (jresp['0'].RequestedObject.FieldContents[VLFieldId].Value != null) {
            (jresp['0'].RequestedObject.FieldContents[VLFieldId].Value.ValuesListIds).forEach(
                (vlid) => {
                    let tobj = vlidef.get(vlid);
                    svlitems.push(new VLItems(tobj.Name, tobj.NameId, tobj.ParentName, tobj.ParentId, tobj.Description, tobj.NumericValue, tobj.SortOrder));
                }
            );
            // An object containing the VL definition and the selected items is returned
            return ({
                AllItems: vlidef,
                SelectedItems: svlitems,
                LastUpdateStr: jresp['0'].RequestedObject.UpdateInformation.UpdateDate
            });
        } else
            return null;
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaSetValuesListValues
     GOAL: Set the VL items passed in input for the specified VLId 
     INPUT: ThisArcherSession and...
     RETURN: true if successful, otherwise throws an error
    -------------------------------------------------------------------------------------*/
    jsaSetValuesListValues = async (ThisArcherSession, ContentId, VLFieldId, items) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaSetValuesListValues] - No Active Session'));

        // Get the Values List Id from the Level Id from the Field Id
        let {
            RelatedValuesListId,
            LevelId,
            Type,
            Name
        } = await jsaGetKeyFieldMetadata(ThisArcherSession, VLFieldId);

        if (Type != 4) // Check if type of field is Values List
            throw Error(MakeError(0, '[jsaSetValuesListValues] - Wrong Field Type, expected a Values List'));

        // Get a map of the Values List Id and the related item names
        let vlmap = await jsaGetValuesListDefinition(ThisArcherSession, RelatedValuesListId);

        // Add the ParentName to the vlmap values (they are objects)
        for (let [key, value] of vlmap) {
            let pname = value.ParentId ? vlmap.get(value.ParentId).Name : "";
            value = {
                ...value,
                ...{
                    ParentName: pname
                }
            };
            vlmap.set(key, value);
        }

        // Look for items of the input array (each item is a [parent, child] array) that match an element
        // in the vlmap. If a match is found, push its VLId into an array which is used to build the payload    let matchingIDs = [];
        let matchingIDs = [];
        items.forEach((item, index) => {
            for (let [key, value] of vlmap) {
                if (value.ParentName == "") {
                    if ((item[0] == "") && (item[1] == value.Name)) {
                        //console.log("[jsaSetValuesListValues] - Root match, found name: \"" + value.Name + "\" ID: " + value.NameId);
                        matchingIDs.push(value.NameId);
                    }
                } else {
                    if ((item[0] == value.ParentName) && (item[1] == value.Name)) {
                        //console.log("[jsaSetValuesListValues] - Parent match, found name: \"" + value.ParentName + "\" NAME: " + value.Name + " ID: " + value.NameId);
                        matchingIDs.push(value.NameId);
                    }
                }
            }
        });

        // Build the Fetch request to update the text
        const requrl = ThisArcherSession.Baseurl + "platformapi/core/content";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'PUT';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        // Build the object to define the payload required by the set content (PUT) API call
        let Payload = {
            Content: {
                Id: ContentId,
                LevelId: LevelId,
                FieldContents: {
                    [VLFieldId]: {
                        Type: 4,
                        Value: {
                            ValuesListIds: matchingIDs
                        },
                        FieldId: VLFieldId
                    }
                }
            }
        }
        request.body = JSON.stringify(Payload);

        let fresp = await fetch(requrl, request);
        if (!fresp.ok)
            throw Error(MakeError(0, '[jsaSetValuesListValues]> ERROR code:' + fresp.status + ' - statusText: "' + fresp.statusText + '"'));
        let jresp = await fresp.json();
        if (jresp.IsSuccessful) {
            return (true);
        } else {
            console.error(`[jsaSetValuesListValues] - ERROR updating the Values List value (MessageKey: "${jresp.ValidationMessages[0].MessageKey}")`);
            console.error('[jsaSetValuesListValues] - ValidationMessages details:', jresp.ValidationMessages);
        }
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaDataFeedGetExecutionStatus
     GOAL: Get the execution status of the data feed identified by the GUID
     INPUT: the Session token and the data feed GUID
     RETURN: a promise with either an object with a set of selected attributes or, in case
     of error, another object encapsulated in a thrown error (captured by a .catch) 
    -------------------------------------------------------------------------------------*/
    jsaDataFeedGetInfo = async (ThisArcherSession, dfGUID) => {
        // Helper function to remap the status and descriptive message
        // This is to reduce the number of states to manage in the FSM 
        // as the Warning and Terminate state are basically a Completed data feed
        function RemapFields(dfh, dfm) {
            switch (dfh.Status) {
                case 4:
                    return ({
                        RStatus: 'COMPLETED',
                        RMessage: "Data Feed completed, but with warnings"
                    })
                case 5:
                case 6:
                    return ({
                        RStatus: 'COMPLETED',
                        RMessage: "Data Feed completed, but due to termination or cancellation"
                    })
                default:
                    return ({
                        RStatus: DFExecutionStatus[dfh.Status], // No change
                        RMessage: dfm != null ? jresp.RequestedObject.DataFeedMessages[0].DatafeedMessage : "None"
                    })
            }
        }

        const DFExecutionStatus = { // Detected through reverse engineering
            '1': 'RUNNING',
            '2': 'COMPLETED',
            '3': 'FAILED',
            '4': 'WARNING',
            '5': 'TERMINATED', // DF is Terminating (remapped for simplicity)
            '6': 'TERMINATED', // DF is Terminated
            '7': 'PENDING'
        }
        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaDataFeedGetInfo] - No Active Session'));
        if (!((typeof (dfGUID) === 'string') && (dfGUID != '')))
            throw new Error(JSON.stringify({ // Errors bubbles up in the promise catch section and is displayed as a tooltip
                Reason: 'Error',
                Severity: 3,
                Description: "The data feed GUID is not defined",
                ErroredValue: "",
                Validator: "",
                ResourcedMessage: "",
                DFMessage: ""
            }));

        const requrl = ThisArcherSession.Baseurl + "platformapi/core/datafeed/history/recent";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        request.body = JSON.stringify({
            Guid: dfGUID
        });
        request.headers = {
            ...request.headers,
            ...{
                'X-Http-Method-Override': 'GET'
            }
        }
        let response;

        // Wait for async calls to complete
        let fresp = await fetch(requrl, request);
        let jresp = await fresp.clone().json();
        let dfh = jresp.RequestedObject.DataFeedHistory;
        let dfm = jresp.RequestedObject.DataFeedMessages; // This is generated in case of specific conditions

        if (jresp.IsSuccessful) {
            // If dfh is defined, the DF completed either successfully or not (REST API weirdness)
            // In this case, possible errors are stored in DFMessages
            if (typeof dfh != 'undefined') {
                console.log(`[jsaDataFeedGetInfo] DETECTED STATUS "${DFExecutionStatus[dfh.Status]}" (#${dfh.Status})`);
                const {
                    RStatus,
                    RMessage
                } = RemapFields(dfh, dfm);
                response = {
                    StartTime: dfh.StartTime,
                    EndTime: dfh.EndTime,
                    SourceRecordsProcessed: dfh.SourceRecordsProcessed,
                    Status: RStatus,
                    Message: RMessage,
                    TargetRecords: {
                        Created: dfh.TargetRecords.Created,
                        Deleted: dfh.TargetRecords.Deleted,
                        Failed: dfh.TargetRecords.Failed,
                        Updated: dfh.TargetRecords.Updated
                    }
                }
            } else {
                // If the DF has never been run, the call returns an empty object (!!)
                console.error(`[jsaDataFeedGetInfo] empty fetch response: is Data Feed enabled or configured? `);
                response = {
                    StartTime: null,
                    EndTime: null,
                    SourceRecordsProcessed: null,
                    Status: 'FAILED',
                    DFMessage: dfm != null ? jresp.RequestedObject.DataFeedMessages[0].DatafeedMessage : "",
                    TargetRecords: {
                        Created: 0,
                        Deleted: 0,
                        Failed: 0,
                        Updated: 0
                    }
                }
            }
        } else {
            // In case of failure, an error is thrown, passing a stringified version of the response
            // In this case the response is captured by the .catch of the promise (onFailure in the FSM)
            console.error(`[jsaDataFeedGetInfo] - Data Feed returned an error`);
            let vm = jresp.ValidationMessages[0];
            throw new Error(JSON.stringify({
                Reason: vm.Reason,
                Severity: vm.Severity,
                Description: vm.Description,
                ErroredValue: vm.ErroredValue,
                Validator: vm.Validator,
                ResourcedMessage: vm.ResourcedMessage,
                DFMessage: dfm != null ? jresp.RequestedObject.DataFeedMessages[0].DatafeedMessage : ""
            }));
        }
        if (typeof response.DFMessage != 'undefined')
            console.warn(`[jsaDataFeedGetInfo] - Message: "${response.DFMessage}"`);
        return (response);
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaDataFeedStart
     GOAL: Execute the data feed identified by the GUID.
     INPUT: the Session token and the data feed GUID
     RETURN: the JSON response of the REST API call or the error
    -------------------------------------------------------------------------------------*/
    jsaDataFeedStart = async (ThisArcherSession, dfGUID) => {

        if (ThisArcherSession == null)
            throw Error(MakeError(0, '[jsaDataFeedStart] - No Active Session'));
        if (!((typeof (dfGUID) === 'string') && (dfGUID != '')))
            throw new Error(JSON.stringify({
                Reason: 'Error',
                Severity: 3,
                Description: "The data feed GUID is not defined",
                ErroredValue: "",
                Validator: "",
                ResourcedMessage: "",
                DFMessage: ""
            }));

        const requrl = ThisArcherSession.Baseurl + "platformapi/core/datafeed/execution";
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'POST';
        AddSessionTokenToHeaders(ThisArcherSession, request);
        request.body = JSON.stringify({
            DataFeedGuid: dfGUID,
            IsReferenceFeedsIncluded: false
        });
        // Invoke the REST API call
        let fresp = await fetch(requrl, request);
        if (!fresp.ok) {
            throw Error(`ERROR - Fetch failed with status ${fresp.statusText}`);
        }
        let jresp = await fresp.json();
        if (jresp.IsSuccessful) {
            return (jresp);
        } else {
            let vm = jresp.ValidationMessages[0];
            throw new Error(JSON.stringify({
                Reason: vm.Reason,
                Severity: vm.Severity,
                Description: vm.Description,
                ErroredValue: vm.ErroredValue,
                Validator: vm.Validator,
                ResourcedMessage: vm.ResourcedMessage
            }));
        }
    }

    /*-------------------------------------------------------------------------------------
     Name: SpinLoader
     GOAL: UTILITY to enable/disable a spinner loader class
     INPUT: container path (string), loader class name and status ("ON" or "OFF")
     RETURN: nothing
    -------------------------------------------------------------------------------------*/
    SpinLoader = (containerpath, spinnerclass, status) => {
        let btaDiagramEl = document.querySelector(containerpath);
        if (btaDiagramEl == null) {
            console.warn(`[SpinLoader] - container in path "${containerpath}" not found`);
            return;
        }

        switch (status) {
            case "ON":
                // If the spinner is already ON, then return
                if (btaDiagramEl.hasChildNodes()) {
                    if (btaDiagramEl.firstElementChild.classList.contains(spinnerclass))
                        return;
                }
                const spinnerdiv = document.createElement('div');
                spinnerdiv.className = spinnerclass;
                btaDiagramEl.appendChild(spinnerdiv);
                break;
            case "OFF":
                if (btaDiagramEl.hasChildNodes())
                    btaDiagramEl.removeChild(btaDiagramEl.firstElementChild)
                break;
        }
    }

    /*-------------------------------------------------------------------------------------
     Name: jsaDeleteContent
     GOAL: Deleted the content record identified by the input ContentId
     INPUT: ThisArcherSession, the record's ContenId
     RETURN: a promise
    -------------------------------------------------------------------------------------*/
    jsaDeleteContent = async (ThisArcherSession, ContentId) => {

        const params = [ThisArcherSession, ContentId];
        if (params.includes(undefined) || params.includes(null)) {
            console.error(`[jsaDeleteContent] - Wrong input parameters`);
            return;
        }

        const requrl = `${ThisArcherSession.Baseurl}platformapi/core/content/${ContentId}`
        let request = {
            ...FetchRequestTemplate
        };
        request.method = 'DELETE';
        AddSessionTokenToHeaders(ThisArcherSession, request);

        return (
            fetch(requrl, request)
            .then((response) => {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.indexOf('application/json') !== -1) {
                    return response.json().then((json) => {
                        if (response.ok) { // Received good JSON data
                            const DeletedRecordId = json.RequestedObject;
                            if (json.IsSuccessful) {
                                return (true);
                            }
                        }
                        if (json.ValidationMessages) {
                            json.ValidationMessages.forEach((msg) => {
                                console.error(`[jsaDeleteContent] - ValidationMessage: ${msg.Description}`);
                            });
                            return Promise.reject(false);
                        }
                        // Error response received. Reject the promise with the appropriate message. 
                        console.error(`[jsaDeleteContent] - Response NOK (JSON error): status=${response.status}, statusText=${response.statusText}`);
                        return Promise.reject(false);
                    });
                }
                return response;
            })
            .catch((e) => e)
        );
    }


    /*------------------------------------------------------*/
    /*          FUNCTIONS PUBLISHED BY THIS MODULE          */
    /*------------------------------------------------------*/
    return { // Publicly available methods
        GetJSONfromHTML,
        jsaGetApplicationList,
        jsaGetApplicationMeta,
        jsaGetAllUsers,
        jsaGetSession,
        jsaGetNumericValue,
        jsaGetTextValue,
        jsaGetDateValue,
        jsaSetTextValue,
        jsaSetNumericValue,
        jsaSetDateValue,
        jsaGetKeyFieldMetadata,
        jsaGetValuesListDefinition,
        jsaGetValuesListValues,
        jsaSetValuesListValues,
        jsaDataFeedStart,
        jsaDataFeedGetInfo,
        jsaGetContentById,
        jsaSetFielContentById,
        SpinLoader,
        jsaDeleteContent
    }
})()

/*-------------------------------------------------------------------------------------
 Name: CLASS jsaSimpleCache
 GOAL: Implement a simple caching mechanism that leverages on the browser localStorage
 to keep the cached data encapsulated in a JSON object. The cache is specific per record
 and accept an optional timeout to implement a time-based caching. This is the flow:
 - As the cache is created, the cached content is retrieved, if available
 - The read/write methods accept am optional reference time that is used as the writing
   time and the reading time (for example using the LastUpdated field of a record). 
   The reference time is defined is ISO format (UTC TZ) 
 - If the reference time is not specified, the current time is used
 - Is the timeout value is 0, the value in the cache is immediately returned
 - If the cache is empty at reading time, null is returned
 CONSTRUCTOR INPUT: name of cache, RecordId, timeout (in seconds)
 So, the cache has two operating modes:
 - Change Detection: uses reference dates in the Read/Write methods: if the read reftime is
   before the write (reftime + timeout) the cached data is returned, otherwise null (TMO expired)
   The change detection is implemented by using the times LastUpdate fields
- Time-Based: no ref times are used, so the current time is used as a reference
  If the data is read within the timeout period of the last write oepration, the cahed data is returned
-------------------------------------------------------------------------------------*/
class jsaSimpleCache {

    constructor(name, recordId, timeout = 0) {
        this.cacheName = `jsaSCache-${name}-${recordId}`;
        this.timeoutValue = timeout;

        let CachedData = JSON.parse(localStorage.getItem(this.cacheName));
        if (CachedData != null) {
            // Retrieve the cached object and update time
            this.rawdata = {
                ...CachedData.data
            };
            this.lastUpdate = new Date(CachedData.lastUpdateISO);
            console.log(`[${this.cacheName}] ==> Restored cached data (@lastUpdateISO=${this.lastUpdate.toISOString()}`);
        } else { // Cache storage empty
            this.rawdata = null;
            this.lastUpdate = null;
        }
    }

    get IsEmpty() {
        return (this.rawdata == null ? true : false);
    }

    // Returns true when the timeout is expired or if it's 0
    // otherwise returns false
    TimeoutExpired(refTimeISO) {
        let refTime = refTimeISO != null ? new Date(refTimeISO) : new Date();
        let timeDiff = parseInt(Math.round((refTime - this.lastUpdate) / 1000));

        if (this.timeoutValue == 0) { // Timeout disabled
            return (true);
        }
        return (timeDiff <= this.timeoutValue ? false : true);
    }

    // Write data in storage
    Write(data, refWriteTimeISO = null) {
        this.rawdata = {
            ...data
        };
        this.lastUpdate = refWriteTimeISO != null ? new Date(refWriteTimeISO) : new Date();
        localStorage.setItem(this.cacheName, JSON.stringify({
            lastUpdateISO: this.lastUpdate.toISOString(),
            data: this.rawdata
        }));
        //console.log(`%c[${this.cacheName}] - Cache Write (lastUpdateISO=${this.lastUpdate.toISOString()}, TMO=${this.timeoutValue})`, 'color: red');
    }

    // Load in memory the data cached into the storage if tmo is not expired, otherwise return false
    Load(refReadTimeISO = null) {
        let CachedData = JSON.parse(localStorage.getItem(this.cacheName));

        if (CachedData != null) {
            // Retrieve the cached object and lastUpdate time
            this.rawdata = {
                ...CachedData.data
            };
            this.lastUpdate = new Date(CachedData.lastUpdateISO);

            if (!this.TimeoutExpired(refReadTimeISO)) {
                //console.log(`%c[${this.cacheName}] - Cache Load (lastUpdateISO=${this.lastUpdate.toISOString()}, refTimeISO=${refReadTimeISO}, TMO=${this.timeoutValue})`, 'color: green');
                return (this.rawdata);
            } else {
                //console.log(`%c[${this.cacheName}] - TIMEOUT EXPIRED (lastUpdateISO=${this.lastUpdate.toISOString()}, refTimeISO=${refReadTimeISO}, TMO=${this.timeoutValue})`, 'color: blue');
                return (null);
            }
        }
        return (null);
    }
}

/*-------------------------------------------------------------------------------------
                                HELPER FUNCTIONS
-------------------------------------------------------------------------------------*/
function formatXml(xml) {
    var formatted = '';
    var reg = /(>)(<)(\/*)/g;
    xml = xml.replace(reg, '$1\r\n$2$3');
    var pad = 0;
    jQuery.each(xml.split('\r\n'), function (index, node) {
        var indent = 0;
        if (node.match(/.+<\/\w[^>]*>$/)) {
            indent = 0;
        } else if (node.match(/^<\/\w/)) {
            if (pad != 0) {
                pad -= 1;
            }
        } else if (node.match(/^<\w[^>]*[^/]>.*$/)) {
            indent = 1;
        } else {
            indent = 0;
        }
        var padding = '';
        for (var i = 0; i < pad; i++) {
            padding += '  ';
        }
        formatted += padding + node + '\r\n';
        pad += indent;
    });
    return formatted;
}

//----------------------------------------------------------
// This function automatically changes the font size to
// fit the text into the hosting div containers of class mdTextFit
//----------------------------------------------------------
const TextFit = () => {

    document.querySelectorAll('.mdTextFit').forEach(function (element, index) {
        let target = element;
        target.style.fontSize = 'initial';

        let child = document.createElement('div');
        child.classList.add("textfit-inner");
        child.setAttribute("style", "display:inline-block;white-space:nowrap");
        child.innerHTML = target.innerHTML;
        target.innerHTML = "";
        target.appendChild(child);

        let fontSize = parseInt(window.getComputedStyle(target, null).getPropertyValue('font-size'));
        let cellHeight = target.parentNode.parentNode.offsetHeight;
        let containerWidth = target.offsetWidth;
        let innerHeight = target.querySelector('.textfit-inner').offsetHeight;
        let innerWidth = target.querySelector('.textfit-inner').offsetWidth;
        let newfontSizeW = (containerWidth * fontSize) / innerWidth;
        let newfontSizeH = (cellHeight * fontSize) / innerHeight;
        // Consider both horizontal and vertical ratio to properly resize text
        let newfontSize = Math.min(newfontSizeW, newfontSizeH);
        let maxFont = target.dataset.textfitMax;
        let minFont = target.dataset.textfitMin;
        let adjust = target.dataset.textfitAdjust;
        if (adjust)
            newfontSize = newfontSize * adjust;
        if (newfontSize > maxFont) {
            newfontSize = maxFont
        } else if (newfontSize < minFont) {
            newfontSize = minFont
        }
        target.style.fontSize = newfontSize + "px";
        target.innerHTML = target.firstChild.innerHTML;
    });
}

//----------------------------------------------
// Format the numeric value to limit the #digits
//----------------------------------------------
const nFormatter = (num, digits) => {
    var si = [{
            value: 1,
            symbol: ""
        },
        {
            value: 1E3,
            symbol: "k"
        },
        {
            value: 1E6,
            symbol: "M"
        },
        {
            value: 1E9,
            symbol: "G"
        },
        {
            value: 1E12,
            symbol: "T"
        },
        {
            value: 1E15,
            symbol: "P"
        },
        {
            value: 1E18,
            symbol: "E"
        }
    ];
    var rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    var i;
    for (i = si.length - 1; i > 0; i--) {
        if (num >= si[i].value) {
            break;
        }
    }
    return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol;
}

//------------------
// Polling function
//------------------
function poll(pollFn, interval = 100) {
    var intervalHandle = null

    return {
        until(conditionFn) {
            return new Promise((resolve, reject) => {
                intervalHandle = setInterval(() => {
                    pollFn().then((data) => {
                        let passesCondition = false;
                        console.log(`>>>Polling (${interval}ms)`);
                        try {
                            passesCondition = conditionFn(data);
                        } catch (e) {
                            reject(e);
                        }
                        if (passesCondition) {
                            resolve(data);
                            clearInterval(intervalHandle);
                        }
                    }).catch(reject)
                }, interval)
            })
        }
    }
}

//-----------------------------
// Format date using ISO format
//-----------------------------
function ISODateString(d) {
    function pad(n) {
        return n < 10 ? '0' + n : n
    }
    return d.getUTCFullYear() + '-' +
        pad(d.getUTCMonth() + 1) + '-' +
        pad(d.getUTCDate()) + 'T' +
        pad(d.getUTCHours()) + ':' +
        pad(d.getUTCMinutes()) + ':' +
        pad(d.getUTCSeconds()) + 'Z'
}

//##################################################################################################
// This is the FINITY FSM open source implementation https://github.com/nickuraltsev/finity
// It's embedded here to minimize the network dependencies. This is the minimified version
//##################################################################################################
! function (t, e) {
    "object" == typeof exports && "object" == typeof module ? module.exports = e() : "function" == typeof define && define.amd ? define([], e) : "object" == typeof exports ? exports.Finity = e() : t.Finity = e()
}(window, function () {
    return function (t) {
        var e = {};

        function n(o) {
            if (e[o]) return e[o].exports;
            var r = e[o] = {
                i: o,
                l: !1,
                exports: {}
            };
            return t[o].call(r.exports, r, r.exports, n), r.l = !0, r.exports
        }
        return n.m = t, n.c = e, n.d = function (t, e, o) {
            n.o(t, e) || Object.defineProperty(t, e, {
                configurable: !1,
                enumerable: !0,
                get: o
            })
        }, n.r = function (t) {
            Object.defineProperty(t, "__esModule", {
                value: !0
            })
        }, n.n = function (t) {
            var e = t && t.__esModule ? function () {
                return t.default
            } : function () {
                return t
            };
            return n.d(e, "a", e), e
        }, n.o = function (t, e) {
            return Object.prototype.hasOwnProperty.call(t, e)
        }, n.p = "", n(n.s = 17)
    }([function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o, r = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (t) {
                return typeof t
            } : function (t) {
                return t && "function" == typeof Symbol && t.constructor === Symbol && t !== Symbol.prototype ? "symbol" : typeof t
            },
            i = n(13),
            s = (o = i) && o.__esModule ? o : {
                default: o
            };
        var u = function () {
            function t(e) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, t), this.parent = e
            }
            return t.prototype.getAncestor = function (t) {
                return this.parent ? this.parent instanceof t ? this.parent : this.parent.getAncestor(t) : null
            }, t.prototype.buildConfig = function () {
                return (0, s.default)(this.config, function e(n) {
                    return n ? n instanceof t ? n.buildConfig() : Array.isArray(n) ? n.map(e) : n && "object" === (void 0 === n ? "undefined" : r(n)) ? (0, s.default)(n, e) : n : n
                })
            }, t
        }();
        e.default = u
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = i(n(0)),
            r = i(n(5));

        function i(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var s = function (t) {
            function e(n) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var o = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return o.config = {
                    transitions: []
                }, o
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.transitionTo = function (t) {
                return this.transition(t)
            }, e.prototype.selfTransition = function () {
                return this.transition(null)
            }, e.prototype.internalTransition = function () {
                return this.transition(null, {
                    isInternal: !0
                })
            }, e.prototype.ignore = function () {
                return this.transition(null, {
                    ignore: !0
                })
            }, e.prototype.transition = function (t, e) {
                var n = new r.default(this, t, e);
                return this.config.transitions.push(n), n
            }, e
        }(o.default);
        e.default = s
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0, e.default = function (t, e) {
            return Object.keys(e).forEach(function (n) {
                t[n] = e[n]
            }), t
        }
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = i(n(11)),
            r = i(n(9));

        function i(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var s = function () {
            function t(e, n, o) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, t), this.rootStateMachine = e, this.currentStateMachine = n, this.taskScheduler = o
            }
            return t.start = function (e) {
                var n = new r.default,
                    i = void 0;
                return i = new o.default(e, n, function (e) {
                    return {
                        stateMachine: new t(i, e, n)
                    }
                }), n.execute(function () {
                    return i.start()
                }), new t(i, i, n)
            }, t.prototype.getCurrentState = function () {
                return this.currentStateMachine.getCurrentState()
            }, t.prototype.getSubmachine = function () {
                var e = this.currentStateMachine.getSubmachine();
                return e ? new t(this.rootStateMachine, e, this.taskScheduler) : null
            }, t.prototype.getStateHierarchy = function () {
                return this.getStateMachines().map(function (t) {
                    return t.getCurrentState()
                })
            }, t.prototype.canHandle = function (t, e) {
                for (var n = this.getStateMachines(), o = n.length - 1; o >= 0; o--)
                    if (n[o].canHandle(t, e)) return !0;
                return !1
            }, t.prototype.handle = function (t, e) {
                var n = this;
                return this.taskScheduler.enqueue(function () {
                    for (var o = n.getStateMachines(), r = o.length - 1; r >= 0; r--)
                        if (o[r].tryHandle(t, e)) return;
                    n.currentStateMachine.handleUnhandledEvent(t, e)
                }), this
            }, t.prototype.getStateMachines = function () {
                var t = [],
                    e = this.rootStateMachine;
                do {
                    t.push(e), e = e.getSubmachine()
                } while (e);
                return t
            }, t.prototype.toString = function () {
                return "StateMachine(currentState: " + this.getCurrentState() + ")"
            }, t
        }();
        e.default = s
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = i(n(0)),
            r = i(n(1));

        function i(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var s = function (t) {
            function e(n, o) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var i = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return i.config = {
                    action: o,
                    successTrigger: new r.default(i),
                    failureTrigger: new r.default(i)
                }, i
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.onSuccess = function () {
                return this.config.successTrigger
            }, e.prototype.onFailure = function () {
                return this.config.failureTrigger
            }, e
        }(o.default);
        e.default = s
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o, r = Object.assign || function (t) {
                for (var e = 1; e < arguments.length; e++) {
                    var n = arguments[e];
                    for (var o in n) Object.prototype.hasOwnProperty.call(n, o) && (t[o] = n[o])
                }
                return t
            },
            i = n(0);
        var s = function (t) {
            function e(n, o) {
                var i = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : {};
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var s = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return s.config = r({
                    targetState: o
                }, i, {
                    actions: [],
                    condition: null
                }), s
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.withAction = function (t) {
                return this.config.actions.push(t), this
            }, e.prototype.withCondition = function (t) {
                return this.config.condition = t, this
            }, e
        }(((o = i) && o.__esModule ? o : {
            default: o
        }).default);
        e.default = s
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = u(n(0)),
            r = u(n(1)),
            i = u(n(12)),
            s = u(n(4));

        function u(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var a = function (t) {
            function e(n) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var o = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return o.config = {
                    entryActions: [],
                    exitActions: [],
                    events: Object.create(null),
                    anyEventTrigger: null,
                    timers: [],
                    asyncActions: [],
                    submachine: null
                }, o
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.onEnter = function (t) {
                return this.config.entryActions.push(t), this
            }, e.prototype.onExit = function (t) {
                return this.config.exitActions.push(t), this
            }, e.prototype.on = function (t) {
                return this.config.events[t] || (this.config.events[t] = new r.default(this)), this.config.events[t]
            }, e.prototype.onAny = function () {
                return this.config.anyEventTrigger || (this.config.anyEventTrigger = new r.default(this)), this.config.anyEventTrigger
            }, e.prototype.onTimeout = function (t) {
                var e = new i.default(this, t);
                return this.config.timers.push(e), e
            }, e.prototype.do = function (t) {
                var e = new s.default(this, t);
                return this.config.asyncActions.push(e), e
            }, e.prototype.submachine = function (t) {
                return this.config.submachine = t, this
            }, e
        }(o.default);
        e.default = a
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o, r = n(0);
        var i = function (t) {
            function e(n) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var o = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return o.config = {
                    stateEnterHooks: [],
                    stateExitHooks: [],
                    stateChangeHooks: [],
                    transitionHooks: [],
                    unhandledEventHooks: []
                }, o
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.onStateEnter = function (t) {
                return this.config.stateEnterHooks.push(t), this
            }, e.prototype.onStateExit = function (t) {
                return this.config.stateExitHooks.push(t), this
            }, e.prototype.onStateChange = function (t) {
                return this.config.stateChangeHooks.push(t), this
            }, e.prototype.onTransition = function (t) {
                return this.config.transitionHooks.push(t), this
            }, e.prototype.onUnhandledEvent = function (t) {
                return this.config.unhandledEventHooks.push(t), this
            }, e
        }(((o = r) && o.__esModule ? o : {
            default: o
        }).default);
        e.default = i
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0, e.default = function (t, e) {
            var n = t.prototype,
                o = e.prototype;
            Object.getOwnPropertyNames(o).filter(function (t) {
                return !n[t] && o[t] instanceof Function && o[t] !== e
            }).forEach(function (t) {
                n[t] = function () {
                    for (var n = o[t], r = arguments.length, i = Array(r), s = 0; s < r; s++) i[s] = arguments[s];
                    return n.apply(this.getAncestor(e), i)
                }
            })
        }
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = function () {
            function t() {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, t), this.queue = [], this.isBusy = !1
            }
            return t.prototype.enqueue = function (t) {
                this.isBusy ? this.queue.push(t) : this.execute(t)
            }, t.prototype.execute = function (t) {
                if (this.isBusy) throw new Error("Cannot execute task because another task is already running.");
                this.isBusy = !0;
                try {
                    for (t(); this.queue.length > 0;) {
                        this.queue.shift()()
                    }
                } finally {
                    this.queue.length > 0 && (this.queue = []), this.isBusy = !1
                }
            }, t
        }();
        e.default = o
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0, e.default = function (t) {
            for (var e = arguments.length, n = Array(e > 1 ? e - 1 : 0), o = 1; o < e; o++) n[o - 1] = arguments[o];
            t.forEach(function (t) {
                return t.apply(void 0, n)
            })
        }
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (t) {
                return typeof t
            } : function (t) {
                return t && "function" == typeof Symbol && t.constructor === Symbol && t !== Symbol.prototype ? "symbol" : typeof t
            },
            r = s(n(10)),
            i = s(n(2));

        function s(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var u = function () {},
            a = function () {
                function t(e, n, r) {
                    if (function (t, e) {
                            if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                        }(this, t), void 0 === e || null === e) throw new Error("Configuration must be specified.");
                    if ("object" !== (void 0 === e ? "undefined" : o(e))) throw new Error("Configuration must be an object.");
                    if (void 0 === e.initialState || null === e.initialState) throw new Error("Initial state must be specified.");
                    this.config = e, this.taskScheduler = n, this.contextFactory = r, this.currentState = null, this.submachines = Object.create(null), this.timerIDs = null, this.asyncActionCancelers = null, this.handleAsyncActionComplete = this.handleAsyncActionComplete.bind(this), this.handleTimeout = this.handleTimeout.bind(this)
                }
                return t.prototype.getCurrentState = function () {
                    return this.currentState
                }, t.prototype.canHandle = function (t, e) {
                    if (!this.isStarted()) return !1;
                    var n = this.createContextWithEvent(t, e);
                    return !!this.getFirstAllowedTransitionForEvent(n)
                }, t.prototype.tryHandle = function (t, e) {
                    if (!this.isStarted()) return !1;
                    var n = this.createContextWithEvent(t, e),
                        o = this.getFirstAllowedTransitionForEvent(n);
                    return !!o && (this.executeTransition(o, n), !0)
                }, t.prototype.handleUnhandledEvent = function (t, e) {
                    if (!(this.config.global.unhandledEventHooks.length > 0)) throw new Error("Unhandled event '" + t + "' in state '" + this.currentState + "'.");
                    (0, r.default)(this.config.global.unhandledEventHooks, t, this.currentState, this.createContextWithEvent(t, e))
                }, t.prototype.isStarted = function () {
                    return null !== this.currentState
                }, t.prototype.start = function () {
                    this.isStarted() || this.enterState(this.config.initialState, this.createContext())
                }, t.prototype.stop = function () {
                    this.isStarted() && (this.exitState(this.createContext()), this.currentState = null)
                }, t.prototype.getSubmachine = function () {
                    return this.isStarted() ? this.submachines[this.currentState] : null
                }, t.prototype.executeTransition = function (t, e) {
                    if (!t.ignore) {
                        t.isInternal || this.exitState(e);
                        var n = null !== t.targetState ? t.targetState : this.currentState;
                        (0, r.default)(this.config.global.transitionHooks, this.currentState, n, e), (0, r.default)(t.actions, this.currentState, n, e), t.isInternal || this.enterState(n, e)
                    }
                }, t.prototype.enterState = function (t, e) {
                    (0, r.default)(this.config.global.stateEnterHooks, t, e);
                    var n = this.config.states[t];
                    n && (0, r.default)(n.entryActions, t, e), null !== this.currentState && this.currentState !== t && (0, r.default)(this.config.global.stateChangeHooks, this.currentState, t, e);
                    try {
                        this.startAsyncActions(t, e), this.startTimers(t), this.startSubmachines(t)
                    } catch (t) {
                        throw this.stopTimers(), this.cancelAsyncActions(), t
                    }
                    this.currentState = t
                }, t.prototype.exitState = function (t) {
                    this.stopSubmachines(), this.stopTimers(), this.cancelAsyncActions(), (0, r.default)(this.config.global.stateExitHooks, this.currentState, t);
                    var e = this.config.states[this.currentState];
                    e && (0, r.default)(e.exitActions, this.currentState, t)
                }, t.prototype.startAsyncActions = function (t, e) {
                    var n = this,
                        o = this.config.states[t];
                    o && o.asyncActions.forEach(function (o) {
                        return n.startAsyncAction(o, t, e)
                    })
                }, t.prototype.startAsyncAction = function (t, e, n) {
                    var o = t.action,
                        r = t.successTrigger,
                        i = t.failureTrigger,
                        s = this.handleAsyncActionComplete;
                    o(e, n).then(function (t) {
                        return s(r, {
                            result: t
                        })
                    }, function (t) {
                        return s(i, {
                            error: t
                        })
                    }), this.asyncActionCancelers = this.asyncActionCancelers || [], this.asyncActionCancelers.push(function () {
                        s = u
                    })
                }, t.prototype.cancelAsyncActions = function () {
                    this.asyncActionCancelers && ((0, r.default)(this.asyncActionCancelers), this.asyncActionCancelers = null)
                }, t.prototype.handleAsyncActionComplete = function (t, e) {
                    var n = (0, i.default)(this.createContext(), e);
                    this.executeTrigger(t, n)
                }, t.prototype.startTimers = function (t) {
                    var e = this,
                        n = this.config.states[t];
                    n && n.timers.length > 0 && (this.timerIDs = n.timers.map(function (t) {
                        return setTimeout(e.handleTimeout, t.timeout, t)
                    }))
                }, t.prototype.stopTimers = function () {
                    this.timerIDs && (this.timerIDs.forEach(clearTimeout), this.timerIDs = null)
                }, t.prototype.handleTimeout = function (t) {
                    this.executeTrigger(t, this.createContext())
                }, t.prototype.startSubmachines = function (e) {
                    var n = this.config.states[e];
                    n && n.submachine && (this.submachines[e] || (this.submachines[e] = new t(n.submachine, this.taskScheduler, this.contextFactory)), this.submachines[e].start())
                }, t.prototype.stopSubmachines = function () {
                    var t = this.submachines[this.currentState];
                    t && t.stop()
                }, t.prototype.createContext = function () {
                    return this.contextFactory(this)
                }, t.prototype.createContextWithEvent = function (t, e) {
                    var n = this.createContext();
                    return n.event = t, void 0 !== e && (n.eventPayload = e), n
                }, t.getFirstAllowedTransition = function (t, e) {
                    for (var n = 0; n < t.length; n++)
                        if (!t[n].condition || t[n].condition(e)) return t[n];
                    return null
                }, t.prototype.getFirstAllowedTransitionForEvent = function (e) {
                    var n = this.config.states[this.currentState];
                    if (!n) return null;
                    var o = null,
                        r = n.events[e.event];
                    return r && (o = t.getFirstAllowedTransition(r.transitions, e)), !o && n.anyEventTrigger && (o = t.getFirstAllowedTransition(n.anyEventTrigger.transitions, e)), o
                }, t.prototype.executeTrigger = function (e, n) {
                    var o = this;
                    this.taskScheduler.execute(function () {
                        var r = t.getFirstAllowedTransition(e.transitions, n);
                        r && o.executeTransition(r, n)
                    })
                }, t
            }();
        e.default = a
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o, r = n(1);
        var i = function (t) {
            function e(n, o) {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var r = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this, n));
                return r.config.timeout = o, r
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e
        }(((o = r) && o.__esModule ? o : {
            default: o
        }).default);
        e.default = i
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0, e.default = function (t, e) {
            var n = Object.getPrototypeOf(t),
                o = Object.create(n);
            return Object.keys(t).forEach(function (n) {
                o[n] = e(t[n])
            }), o
        }
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o = u(n(0)),
            r = u(n(7)),
            i = u(n(6)),
            s = u(n(3));

        function u(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        var a = function (t) {
            function e() {
                ! function (t, e) {
                    if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function")
                }(this, e);
                var n = function (t, e) {
                    if (!t) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
                    return !e || "object" != typeof e && "function" != typeof e ? t : e
                }(this, t.call(this));
                return n.config = {
                    global: new r.default(n),
                    initialState: null,
                    states: Object.create(null)
                }, n
            }
            return function (t, e) {
                if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function, not " + typeof e);
                t.prototype = Object.create(e && e.prototype, {
                    constructor: {
                        value: t,
                        enumerable: !1,
                        writable: !0,
                        configurable: !0
                    }
                }), e && (Object.setPrototypeOf ? Object.setPrototypeOf(t, e) : t.__proto__ = e)
            }(e, t), e.prototype.global = function () {
                return this.config.global
            }, e.prototype.initialState = function (t) {
                return this.config.initialState = t, this.state(t)
            }, e.prototype.state = function (t) {
                return this.config.states[t] || (this.config.states[t] = new i.default(this)), this.config.states[t]
            }, e.prototype.getConfig = function () {
                return this.buildConfig()
            }, e.prototype.start = function () {
                var t = this.getConfig();
                return s.default.start(t)
            }, e
        }(o.default);
        e.default = a
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0, e.StateMachineConfigurator = void 0;
        var o = f(n(14)),
            r = f(n(7)),
            i = f(n(6)),
            s = f(n(1)),
            u = f(n(5)),
            a = f(n(4)),
            c = f(n(8));

        function f(t) {
            return t && t.__esModule ? t : {
                default: t
            }
        }
        e.StateMachineConfigurator = o.default, (0, c.default)(r.default, o.default), (0, c.default)(i.default, o.default), (0, c.default)(u.default, i.default), (0, c.default)(u.default, s.default), (0, c.default)(u.default, a.default)
    }, function (t, e, n) {
        "use strict";
        e.__esModule = !0;
        var o, r = n(15),
            i = n(3),
            s = (o = i) && o.__esModule ? o : {
                default: o
            };
        var u = {
            configure: function () {
                return new r.StateMachineConfigurator
            },
            start: function (t) {
                return s.default.start(t)
            }
        };
        e.default = u
    }, function (t, e, n) {
        "use strict";
        var o = n(16).default;
        (0, n(2).default)(e, o), e.default = o
    }])
});