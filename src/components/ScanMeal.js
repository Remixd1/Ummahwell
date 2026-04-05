import React, { useRef, useEffect, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";
import { getAuth } from "firebase/auth";
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function ScanMeal({ addFoodToDiary }) {
  const videoRef = useRef(null); // creates DOM element - allows React to manipulate the feed
  const [selectedFood, setSelectedFood] = useState(null);
  const [servingSize, setServingSize] = useState("1");
  const [scanStatus, setScanStatus] = useState("Waiting for barcode...");
  const [scanError, setScanError] = useState(null);
  
  // Helper component for macro circles
  function MacroCircle({ label, value, color, unit }) {
    return (
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: "50%",
            background: "#f5f5f5",
            border: `3px solid ${color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto",
            fontWeight: "bold",
            fontSize: 18,
            color: color,
          }}
        >
          {value}{unit}
        </div>
        <div style={{ marginTop: 6, fontSize: 14, color: "#333" }}>{label}</div>
      </div>
    );
  }

  // Helper for macros
  const getMacro = (food, attrId) => {
    return Math.round((food.full_nutrients?.find(n => n.attr_id === attrId)?.value || 0) * (parseFloat(servingSize) || 0));
  };

  const mapOffProductToFood = (product) => {
    const caloriesServing = product.nutriments?.["energy-kcal_serving"];
    const calories100g = product.nutriments?.["energy-kcal_100g"];
    const calories = caloriesServing || calories100g || 0;
    const proteins = product.nutriments?.proteins_serving || product.nutriments?.proteins_100g || 0;
    const fat = product.nutriments?.fat_serving || product.nutriments?.fat_100g || 0;
    const carbs = product.nutriments?.carbohydrates_serving || product.nutriments?.carbohydrates_100g || 0;
    const servingSizeText = product.serving_size || "";
    const parsedServing = parseFloat(servingSizeText);
    const servingUnit = servingSizeText.replace(parsedServing, "").trim();

    return {
      ...product,
      food_name: product.product_name_en || product.generic_name_en || product.product_name || product.generic_name || product.brands || "Unknown product",
      brand_name: product.brands,
      nf_calories: calories,
      serving_qty: parsedServing || null,
      serving_unit: servingUnit || "",
      nf_ingredient_statement: product.ingredients_text || product.ingredients_text_en,
      full_nutrients: [
        { attr_id: 203, value: proteins },
        { attr_id: 204, value: fat },
        { attr_id: 205, value: carbs },
      ],
    };
  };

  // Helper for calories
  const getCalories = (food) => {
    if (food.nf_calories) return Math.round(food.nf_calories * (parseFloat(servingSize) || 0));
    return "N/A";
  };

  // --- Boycott and Haram logic from LogFood.js ---
  const haramIngredients = [
    "gelatin",
    "marshmallow",
    "rice krispies",
    "lard",
    "pork",
    "bacon",
    "ham",
    "rum",
    "beer",
    "wine",
    "ethanol",
    "vanilla extract",
    "carmine",
    "cochineal",
    "pepsin",
    "rennet",
    "shortening (animal)",
    "animal fat",
    "emulsifier (animal)",
    "enzymes (porcine)",
    "lipase (porcine)",
    "monoglycerides (animal)",
    "diglycerides (animal)"
  ];

  const meat = ["lamb", "beef", "chicken", "turkey", "duck", "goose", "rabbit", "goat"];

  const companies = [
    "tim hortons", "tim horton's", "starbucks", "nestle", "coca cola", "pepsi", "kraft", "mondelez", "unilever", "procter & gamble",
    "general mills", "campbell's soup", "7up", "mcdonald's", "burger king", "kfc", "pizza hut", "domino's pizza", "sodastream"
  ];

  const normalize = str =>
    (str || "")
      .replace(/\([^)]*\)/g, '')
      .replace(/[^\w\s]/gi, '')
      .toLowerCase()
      .trim();

  const handleAdd = async (food) => {
    // Boycott check
    const foodBrand = food.brand_name ? normalize(food.brand_name) : "";
    const foodName = food.food_name ? normalize(food.food_name) : "";

    const isBoycotted = companies.some(company => {
      const normalizedCompany = normalize(company);
      const regex = new RegExp(`\\b${normalizedCompany}\\b`, 'i');
      return regex.test(foodBrand) || regex.test(foodName);
    }); // Check if the food brand or name matches any company in the boycott list

    if (isBoycotted) {
      alert("Warning: This food is produced by a company on the boycott list."); // Alert user if so
    }

    // Check in food name or brand name
    if (food.brand_name) {
      if (food.nf_ingredient_statement) {
        const ingredientsStr = food.nf_ingredient_statement.toLowerCase();
        const foundHaram = haramIngredients.find(haram => // Cross reference with haram array
          ingredientsStr.includes(haram));
        const foundMeat = meat.find(meat =>
          ingredientsStr.includes(meat)
        );
        if (foundHaram) {
          alert(`WARNING: ${food.food_name || food.name} contains haram ingredients.`);
        }
        else if (foundMeat) {
          alert(`WARNING: ${food.food_name || food.name} contains meat which may not be halal-certified.`);
        }
      } 
      else {
        alert(`WARNING: ${food.food_name || food.name} COULD be haram, please verify manually.`);
        console.log("No list");
      }
    }

    setSelectedFood(food); // Pass selected food to appropriate function
    setServingSize("1");
  };

  const confirmAddFood = async () => {
      const servingNum = parseFloat(servingSize);
      if (!servingSize || isNaN(servingNum) || servingNum <= 0) {
        alert("Please enter a valid serving size.");
        return;
      }
      
      if (addFoodToDiary) addFoodToDiary(selectedFood); // Add food to diary, Firestore will handle the rest, as long as addFoodToDiary was passed down
  
      // Adjust macros based on the serving size
      const adjustedCalories = Math.round((selectedFood.nf_calories || 0) * servingNum);
      const protein = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 203)?.value || 0) * servingNum); // Protein (attr_id: 203)
      const fat = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 204)?.value || 0) * servingNum);    // Fat (attr_id: 204)
      const carbs = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 205)?.value || 0) * servingNum);  // Carbs (attr_id: 205)
  
      // Add to Firestore for the user
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) {
          alert('You must be logged in to add food.');
          return;
        }
        await addDoc( // Add food to Firestore
          collection(db, 'users', user.uid, 'foods'),
          {
            food_name: selectedFood.food_name,
            brand_name: selectedFood.brand_name,
            nf_calories: adjustedCalories, // Adjusted calories
            protein, // Adjusted protein
            fat,     // Adjusted fat
            carbs,   // Adjusted carbs
            serving_size: servingNum, // Store the serving size
            timestamp: serverTimestamp()
          }
        );
        setSelectedFood(null); // Close popup after adding
      } catch (error) {
        console.error('Error adding food to Firestore:', error);
        alert(error);
      }
    };

  useEffect(() => { // useEffect to handle camera access and QR code scanning, real-world implementation
    let codeReader;
    let stream;

    async function enableCamera() {
      try {
        setScanStatus("Requesting camera permission...");
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setScanStatus("Scanning for barcode...");
          setScanError(null);
          codeReader = new BrowserMultiFormatReader(); // using @Zxing/library
          codeReader.decodeFromVideoDevice(null, videoRef.current, (result, err) => { // get barcode from camera
            if (result) {
              const upc = result.getText();
              setScanStatus(`Detected barcode ${upc}. Looking up product...`);
              codeReader.reset();
              fetch(`https://world.openfoodfacts.org/api/v2/product/${upc}.json`, {
                headers: {
                  "User-Agent": "UmmahWell/1.0 (support@ummahwell.example)",
                }
              })
                .then(res => res.json())
                .then(data => {
                  if (data && data.status === 1 && data.product) {
                    setScanStatus("Product found.");
                    handleAdd(mapOffProductToFood(data.product));
                  } else {
                    setScanStatus("No food found for this UPC.");
                    alert("No food found for this UPC.");
                  }
                })
                .catch(err => {
                  console.error("Open Food Facts barcode lookup error:", err);
                  setScanError("Error fetching food info.");
                  alert("Error fetching food info.");
                });
            }
          });
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        setScanError("Camera access denied. Please allow camera access or use a supported browser.");
        setScanStatus(null);
      }
    }
    enableCamera(); // start camera access

    return () => {
      if (codeReader) codeReader.reset();
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  return ( // html for webpage
    <div>
      <h2>Scan Meal</h2>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%", maxWidth: 400, borderRadius: 8, border: "1px solid #ccc" }}
      />
      {scanError && <p style={{ color: "red", marginTop: 12 }}>{scanError}</p>}
      {scanStatus && <p style={{ marginTop: 12 }}>{scanStatus}</p>}

      {selectedFood && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Log Food</h3>
            <p>
              <strong>{selectedFood.food_name || selectedFood.name}</strong>
            </p>
            <p>
              <strong>Serving Size:</strong>{" "}
              {selectedFood.serving_qty || 1} {selectedFood.serving_unit || ""}
              {selectedFood.serving_weight_grams
                ? ` (${selectedFood.serving_weight_grams}g)`
                : ""}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, margin: "16px 0" }}>
              <MacroCircle
                label="Protein"
                value={getMacro(selectedFood, 203)}
                color="#4caf50"
                unit="g"
              />
              <MacroCircle
                label="Carbs"
                value={getMacro(selectedFood, 205)}
                color="#2196f3"
                unit="g"
              />
              <MacroCircle
                label="Fat"
                value={getMacro(selectedFood, 204)}
                color="#ff9800"
                unit="g"
              />
            </div>
            <p>Calories: {getCalories(selectedFood)}</p>
            <div>
              <label htmlFor="serving-size">Serving Size:</label>
              <input
                id="serving-size"
                type="number"
                min="0.1"
                step="0.1"
                value={servingSize}
                onChange={e => setServingSize(e.target.value)}
              />
            </div>
            <div className="popup-actions">
              <button onClick={() => setSelectedFood(null)}>Cancel</button>
              <button onClick={confirmAddFood}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ScanMeal;