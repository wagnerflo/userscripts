// ==UserScript==
// @name             Fetlife Picture Downloader
// @version          1
// @match            *://fetlife.com/*/pictures/*
// @require          https://cdn.jsdelivr.net/gh/CoeJoder/waitForKeyElements.js@v1.3/waitForKeyElements.js
// @require          https://raw.githubusercontent.com/Adrianotiger/CreateElement/refs/tags/Ver1/dist/cn.min.js
// @require          https://raw.githubusercontent.com/albell/parse-srcset/refs/tags/v1.0.2/src/parse-srcset.js
// @require          https://raw.githubusercontent.com/eligrey/FileSaver.js/refs/tags/v2.0.4/dist/FileSaver.min.js
// @grant            GM.xmlHttpRequest
// ==/UserScript==

const download = (args) =>
	new Promise(resolve =>
    GM.xmlHttpRequest({
      method: "GET",
      ...args,
      onload: (resp) => resolve(resp),
    })
  );

const NS = {
  RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  DC: "http://purl.org/dc/elements/1.1/",
  XMP: "http://ns.adobe.com/xap/1.0/",
};

const XMP_TEMPLATE = (
  '<root>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="jpeg-xmp-writer">' +
      `<rdf:RDF xmlns:rdf="${NS.RDF}">` +
        `<rdf:Description xmlns:xmp="${NS.XMP}" xmlns:dc="${NS.DC}" />` +
      '</rdf:RDF>' +
    '</x:xmpmeta>' +
  '</root>'
);

const writeXMP = (buffer, props) => {
  let xmp = (new DOMParser()).parseFromString(XMP_TEMPLATE, "text/xml").documentElement;
  const descriptionNode = xmp.getElementsByTagName("rdf:Description")[0];

  for (let [attr, val] of Object.entries(props)) {
    if (attr.startsWith("xmp:"))
      descriptionNode.setAttribute(attr, val);
    else if (attr.startsWith("dc:")) {
      if (typeof(val) === "string")
        val = [val];
      const dc = document.createElementNS(NS.DC, attr.substr(3));
      const bag = document.createElementNS(NS.RDF, "Bag");
      for (const v of val) {
        const li = document.createElementNS(NS.RDF, "li");
        li.appendChild(document.createTextNode(v));
        bag.appendChild(li);
      }
      dc.appendChild(bag);
      descriptionNode.appendChild(dc);
    }
  }

  const dvIn = new DataView(buffer);
  const pos = 4 + dvIn.getUint16(4);
  const encodedPayload = new TextEncoder().encode(
    'XXXX' +
    'http://ns.adobe.com/xap/1.0/\0' +
    '<?xpacket begin="XXX" id="W5M0MpCehiHzreSzNTczkc9d?>' +
    xmp.innerHTML +
    ' '.repeat(2000) +
    '<?xpacket end="w"?>'
  );

  const dvOut = new DataView(encodedPayload.buffer);
  dvOut.setUint16(0, 0xFFE1);
  dvOut.setUint16(2, encodedPayload.buffer.byteLength - 2);
  dvOut.setUint16(50, 0xEFBB);
  dvOut.setUint8(52, 0xBF);

  const inArr = new window.Uint8Array(buffer);
  const outBuffer = new ArrayBuffer(inArr.length + encodedPayload.length);
  const outArr = new Uint8Array(outBuffer);
  outArr.set(inArr.subarray(0, pos));
  outArr.set(encodedPayload, pos);
  outArr.set(inArr.subarray(pos), pos + encodedPayload.length);

  return outArr;
};

const removeExif = async (buf) => {
  let offset = 0;
  let recess = 0;
  let pieces = [];
  let i = 0;
  let app1;
  const dv = new DataView(buf);
  const getUint16 = () => dv.getUint16(offset);
  if (getUint16() !== 0xffd8)
    throw new Error("Invalid JPEG header");
  offset += 2;
  app1 = getUint16();
	offset += 2;
	while (offset < dv.byteLength) {
    if (app1 === 0xffe1) {
      pieces[i] = { recess, offset: offset - 2 };
      recess = offset + getUint16();
      i++;
    }
    else if (app1 === 0xffda){
      break;
    }
    offset += getUint16();
    app1 = getUint16();
    offset += 2;
  }
  if (pieces.length == 0)
    throw new Error("No pieces.")
  let newPieces = pieces.map(
    ({ recess, offset }) => buf.slice(recess, offset)
  );
  newPieces.push(buf.slice(recess));
  return await (new Blob(newPieces)).arrayBuffer();
};

const onClick = async (splide) => {
  const hasSlides = splide.querySelectorAll(".splide__slide").length > 1;
  const slide = splide.querySelector(".splide__slide.is-active");
  const srcset = parseSrcset(slide.querySelector("img[srcset]").getAttribute("srcset"));
  const resp = await download({
	  url: srcset.sort((a, b) => (a.d || 0) > (b.d || 0)).pop().url,
    headers: { referer: "https://fetlife.com/" },
    responseType: "arraybuffer",
  });
	if (resp.status !== 200)
  	return alert(`Download error ${resp.status}: ${await resp.response.text()}`);
  const mime = resp.responseHeaders.match(/^content-type:\s+(.*)\s*$/mi);
  if (mime === null)
    return alert(`Response has not Content-Type header.`);
  if (mime[1] !== "image/jpeg")
    return alert(`Unsupported MIME in response: ${mime[1]}`);
	const xmpArrayBuffer = writeXMP(await removeExif(resp.response), {
    "dc:relation": `${document.location.href}${hasSlides ? `#${slide.id}` : ""}`,
  });
  const parts = document.location.pathname.match("^/(.+)/pictures/(\\d+)$");
  const [slidenum] = slide.id.match("\\d+$");
  saveAs(
    new Blob([xmpArrayBuffer], { type: mime }),
    parts === null
      ? "unknown.jpg"
      : `${parts[1]}_${parts[2]}${hasSlides ? `_${slidenum}` : ""}.jpg`
  );
}

waitForKeyElements("#splide01", (splide) => {
  const btn = _CN("button", {
    "class": "border link text-red-100 border-red-600 bg-red-600 fill-current leading-snug text-sm py-2 px-3.5 hover:text-red-100 hover:bg-red-700 focus:bg-red-700 font-normal",
    "type": "button",
  }, [
    _CN("span", { "class": "whitespace-nowrap"}, ["Download"])
  ]);
  btn.addEventListener("click", () => onClick(splide));
  splide.parentElement.parentElement.appendChild(
  	_CN("div", { "class": "flex justify-center mt-2.5 mb-3" }, [
      _CN("div", { "class": "inline-block"}, [btn])
    ])
  );
});