const axios = require("axios");

async function testInject() {
  const response = await axios.post("http://localhost:3000/inject-section", {
    sectionId: "cws-t01-horizontal-scroll",
  });
  console.log(response.data);
}

testInject().catch(console.error);
